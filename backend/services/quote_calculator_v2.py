"""Quote Calculator v2.2 — point estimate with tolerance factors.

Loads coefficient and material files from backend/data/quote_model_v2_1/
and computes deterministic quotes using the v2.1 additive formula,
v2.2 adds tight estimate bands, tolerance grading, and split postprocess.
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from services.exchange_rates import convert_rmb

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "quote_model_v2_2"
SAFETY_MULTIPLIER = 1.00  # v2.2-A.1: removed safety pad
DIFFICULTY_FACTOR = 1.0


# ── Tolerance factors ───────────────────────────

_TOLERANCE_FACTORS: dict[str, tuple[str, float]] = {
    "ISO2768-C": ("ISO 2768-c", 1.00),
    "ISO2768-M": ("ISO 2768-m", 1.05),
    "ISO2768-F": ("ISO 2768-f", 1.20),
}
_DEFAULT_TOLERANCE = "ISO2768-M"

_OLD_TOLERANCE_MAP = {"GENERAL": "ISO2768-M", "": "ISO2768-M"}


def _normalize_tolerance_grade(raw: str) -> str:
    key = str(raw or "").strip()
    if not key:
        return _DEFAULT_TOLERANCE
    if key in _TOLERANCE_FACTORS:
        return key
    return _OLD_TOLERANCE_MAP.get(key, _DEFAULT_TOLERANCE)


def _tolerance_factor(grade: str) -> float:
    return _TOLERANCE_FACTORS.get(grade, _TOLERANCE_FACTORS[_DEFAULT_TOLERANCE])[1]


def _tolerance_label(grade: str) -> str:
    return _TOLERANCE_FACTORS.get(grade, _TOLERANCE_FACTORS[_DEFAULT_TOLERANCE])[0]


# ── Estimate band policy ────────────────────────

def _estimate_band_policy(
    material_category: str,
    process_group: str,
    postprocess_group: str,
    quantity: int,
) -> tuple[float, float, str]:
    """Return (low_pct, high_pct, risk_level)."""
    # High risk conditions
    high_post = postprocess_group in ("电镀涂层", "热处理")
    high_mat = material_category in ("specialty_metal", "high_performance_plastic")
    high_proc = process_group in ("车铣复合", "板金")

    if high_mat or high_proc or high_post:
        return (-0.06, 0.12, "high")
    if quantity >= 500 or postprocess_group == "阳极氧化" or process_group in ("车床", "车铣复合"):
        return (-0.05, 0.08, "medium")
    return (-0.04, 0.06, "low")


# ── Stable random estimate ──────────────────────

def _stable_estimate_in_band(
    base_rmb: float,
    low_pct: float,
    high_pct: float,
    seed_parts: list[str],
) -> tuple[float, dict]:
    """Return (estimate_rmb, seed_info)."""
    low = base_rmb * (1.0 + low_pct)
    high = base_rmb * (1.0 + high_pct)
    seed_str = "|".join(seed_parts)
    digest = hashlib.sha256(seed_str.encode("utf-8")).hexdigest()
    ratio = int(digest[:8], 16) / 0xFFFFFFFF
    estimate = low + ratio * (high - low)
    return estimate, {
        "unit_min_rmb": round(low, 2),
        "unit_max_rmb": round(high, 2),
        "band_policy": "tight_v1",
        "random_seed": digest[:16], 
    }


# ── Data loading (cached) ───────────────────────

_cache: dict[str, Any] = {}


def _load_json(name: str) -> dict:
    if name not in _cache:
        with open(DATA_DIR / name, encoding="utf-8") as f:
            _cache[name] = json.load(f)
    return _cache[name]


def _load_csv(name: str) -> list[dict]:
    cache_key = f"csv_{name}"
    if cache_key not in _cache:
        with open(DATA_DIR / name, encoding="utf-8-sig") as f:
            _cache[cache_key] = list(csv.DictReader(f))
    return _cache[cache_key]


def coefficients() -> dict:
    return _load_json("coefficients_v2_2_A.json")


def materials() -> list[dict]:
    return _load_csv("material_prices.csv")


def material_categories() -> dict:
    return _load_json("material_public_options.json")


def material_price_by_id(price_id: str) -> dict:
    """Look up a single material price row by price_id."""
    mat_list = materials()
    for m in mat_list:
        if m.get("price_id", "").strip() == price_id.strip():
            if m.get("is_active", "1") != "0":
                return m
    raise ValueError(f"Material not found or inactive: {price_id!r}")


# ── OBB parsing ─────────────────────────────────

def parse_obb_dimensions(value: str) -> tuple[float, float, float]:
    parts = str(value or "").replace("\u00d7", "x").lower().split("x")
    nums = [float(p.strip()) for p in parts if p.strip()]
    if len(nums) != 3 or any(n <= 0 for n in nums):
        raise ValueError("obb_dimensions_mm must contain three positive dimensions")
    return tuple(nums)


# ── Quantity tier ───────────────────────────────

def _quantity_tier(quantity: int) -> tuple[str, float]:
    coef = coefficients()
    deltas = coef["deltas"]
    if quantity <= 1:
        return "q_001_001", deltas["q_001_001"]
    if quantity <= 5:
        return "q_002_005", deltas["q_002_005"]
    if quantity <= 10:
        return "q_006_010", deltas["q_006_010"]
    if quantity <= 50:
        return "q_011_050", deltas["q_011_050"]
    if quantity <= 100:
        return "q_051_100", deltas["q_051_100"]
    if quantity <= 500:
        return "q_101_500", deltas["q_101_500"]
    return "q_501_plus", deltas.get("q_501_plus", 0.6973)


# ── Lookups ──────────────────────────────────────

def _find_material(price_id: str = "", material_category: str = "") -> dict:
    """Resolve material from price_id or category default."""
    # 1. Direct price_id lookup
    if price_id:
        return material_price_by_id(price_id)
    # 2. Category default
    if material_category:
        cats = material_categories()
        for cat in cats.get("categories", []):
            if cat["id"] == material_category:
                default_id = cat.get("default_material_id", "")
                if default_id:
                    return material_price_by_id(default_id)
    raise ValueError(f"Provide material_id or a valid material_category with a default")


def _find_process(process_id: str) -> str:
    coef = coefficients()
    if process_id in coef.get("material_markup_by_process", {}):
        return process_id
    aliases = _load_csv("process_aliases.csv")
    for a in aliases:
        if a.get("alias", "").strip() == process_id.strip():
            resolved = a.get("process_norm", "").strip()
            if resolved in coef.get("material_markup_by_process", {}):
                return resolved
    raise ValueError(f"Unsupported process: {process_id!r}")


def _find_postprocess(postprocess_id: str) -> str:
    coef = coefficients()
    if postprocess_id in coef.get("postprocess_fee_by_group", {}):
        return postprocess_id
    aliases = _load_csv("postprocess_aliases.csv")
    norm = None
    for a in aliases:
        if a.get("alias", "").strip() == postprocess_id.strip():
            norm = a.get("postprocess_norm", "").strip()
            break

    if norm == "喷砂":
        return "喷砂抛光"
    if norm == "抛光":
        return "喷砂抛光"

    if norm:
        groups_csv = _load_csv("postprocess_groups.csv")
        for g in groups_csv:
            if g.get("postprocess_norm", "").strip() == norm:
                group = g.get("postprocess_group", "").strip()
                if group in coef.get("postprocess_fee_by_group", {}):
                    return group

    fallback = "其他后处理"
    if fallback in coef.get("postprocess_fee_by_group", {}):
        return fallback
    raise ValueError(f"Unsupported postprocess: {postprocess_id!r}")


# ── Internal accessors ──────────────────────────

def _process_material_markup(process_group: str) -> float:
    coef = coefficients()
    return float(coef["material_markup_by_process"][process_group])


def _process_setup_fee(process_group: str) -> float:
    coef = coefficients()
    return float(coef["setup_fee_by_process"][process_group])


def _process_machining_base(process_group: str) -> float:
    coef = coefficients()
    return float(coef["machining_base_by_process"][process_group])


def _postprocess_fee(postprocess_group: str) -> float:
    coef = coefficients()
    return float(coef["postprocess_fee_by_group"][postprocess_group])


def _process_sample_count(process_group: str) -> int:
    coef = coefficients()
    return int(coef.get("process_group_counts", {}).get(process_group, 0))


def _postprocess_sample_count(postprocess_group: str) -> int:
    coef = coefficients()
    return int(coef.get("postprocess_group_counts", {}).get(postprocess_group, 0))


# ── Public labels ────────────────────────────────

_PROCESS_LABELS = {
    "CNC": "CNC Machining",
    "车床": "Turning",
    "车铣复合": "Mill-Turn Machining",
    "板金": "Sheet Metal Fabrication",
}

_POSTPROCESS_LABELS = {
    "去毛刺": "Deburring",
    "钝化": "Passivation",
    "电解抛光": "Electropolishing",
    "喷砂抛光": "Bead Blasting / Polishing",
    "阳极氧化": "Anodizing",
    "镭雕": "Laser Marking",
    "热处理": "Heat Treatment",
    "电镀涂层": "Plating / Coating",
}

# v2.2: split postprocess public options
_PUBLIC_POSTPROCESS_OPTIONS = [
    {"id": "none", "label": "No Finish / As Machined", "internal_group": "去毛刺"},
    {"id": "deburring", "label": "Deburring", "internal_group": "去毛刺"},
    {"id": "anodizing", "label": "Anodizing", "internal_group": "阳极氧化"},
    {"id": "black_oxide", "label": "Black Oxide", "internal_group": "电镀涂层"},
    {"id": "zinc_plating", "label": "Zinc Plating", "internal_group": "电镀涂层"},
    {"id": "nickel_plating", "label": "Nickel Plating", "internal_group": "电镀涂层"},
    {"id": "other_plating", "label": "Other Plating / Coating", "internal_group": "电镀涂层"},
    {"id": "passivation", "label": "Passivation", "internal_group": "钝化"},
    {"id": "bead_blasting", "label": "Bead Blasting", "internal_group": "喷砂抛光"},
    {"id": "polishing", "label": "Polishing", "internal_group": "喷砂抛光"},
    {"id": "electropolishing", "label": "Electropolishing", "internal_group": "电解抛光"},
    {"id": "heat_treatment", "label": "Heat Treatment", "internal_group": "热处理"},
    {"id": "laser_marking", "label": "Laser Marking", "internal_group": "镭雕"},
    {"id": "other", "label": "Other Finish", "internal_group": "其他后处理"},
]

_PUBLIC_POSTPROCESS_BY_ID = {o["id"]: o for o in _PUBLIC_POSTPROCESS_OPTIONS}


def _process_label(pg: str) -> str:
    return _PROCESS_LABELS.get(pg, pg)


def _postprocess_label(pg: str) -> str:
    return _POSTPROCESS_LABELS.get(pg, pg)


def _resolve_public_postprocess(public_id: str) -> tuple[str, str]:
    """Resolve public postprocess id → (internal_group, public_label)."""
    opt = _PUBLIC_POSTPROCESS_BY_ID.get(public_id)
    if opt:
        return opt["internal_group"], opt["label"]
    # Fallback: try direct group match
    return _find_postprocess(public_id), _postprocess_label(public_id)


# ── Options ─────────────────────────────────────

def get_quote_options_v2() -> dict:
    coef = coefficients()
    cats = material_categories()

    mat_cats = []
    for cat in cats.get("categories", []):
        mat_cats.append({
            "id": cat["id"],
            "label": cat["label"],
            "description": cat.get("description", ""),
            "default_material_id": cat.get("default_material_id", ""),
            "materials": [
                {
                    "id": m["id"],
                    "label": m["label"],
                    "subtitle": m.get("subtitle", ""),
                    "badges": m.get("badges", []),
                    "review_recommended": m.get("review_recommended", False),
                }
                for m in cat.get("materials", [])
            ],
        })

    procs = []
    for pg in coef.get("material_markup_by_process", {}):
        if pg == "其他工艺":
            continue
        procs.append({"id": pg, "label": _process_label(pg)})

    pp_groups = []
    for opt in _PUBLIC_POSTPROCESS_OPTIONS:
        pp_groups.append({"id": opt["id"], "label": opt["label"]})

    return {
        "material_categories": mat_cats,
        "processes": procs,
        "postprocess_groups": pp_groups,
        "tolerance_grades": [
            {"grade": grade, "label": label}
            for grade, (label, _) in _TOLERANCE_FACTORS.items()
        ],
        "currencies": ["USD", "EUR"],
        "default_currency": "USD",
    }


# ── Main calculate ──────────────────────────────

def calculate_quote_v2(payload: dict) -> dict:
    quantity = int(payload.get("quantity", 1))
    if quantity < 1 or quantity > 100000:
        raise ValueError("Quantity must be 1–100,000")
    dims = parse_obb_dimensions(payload.get("obb_dimensions_mm", ""))
    l, w, h = dims
    cat_id = payload.get("material_category", "")
    mat_id = payload.get("material_id", "")
    cats = material_categories()

    # Resolve material
    material = _find_material(price_id=mat_id, material_category=cat_id)
    density = float(material["density_g_cm3"])
    price_per_kg = float(material["price_rmb_per_kg"])

    # Validate material data integrity
    import math
    if not (math.isfinite(density) and density > 0 and math.isfinite(price_per_kg) and price_per_kg > 0):
        raise ValueError("Material price data is incomplete. Please request a formal quote instead.")
    process_raw = str(payload.get("process", "CNC"))
    process_group = _find_process(process_raw)
    pp_raw = str(payload.get("postprocess_group", "去毛刺"))
    postprocess_group, postprocess_public_label = _resolve_public_postprocess(pp_raw)
    tolerance_raw = str(payload.get("tolerance_grade", "ISO2768-M"))
    tolerance_grade = _normalize_tolerance_grade(tolerance_raw)
    tolerance_factor = _tolerance_factor(tolerance_grade)
    tolerance_label = _tolerance_label(tolerance_grade)
    currency = str(payload.get("currency", "USD")).upper()
    if currency not in ("CNY", "USD", "EUR"):
        raise ValueError(f"Unsupported currency: {currency!r}. Supported: CNY, USD, EUR.")
    customer_email = str(payload.get("customer_email", "")).strip()
    customer_name = str(payload.get("customer_name", "")).strip()

    warnings = []
    pp_count = _postprocess_sample_count(postprocess_group)
    proc_count = _process_sample_count(process_group)
    if proc_count < 20:
        warnings.append(f"Process '{process_group}' has low sample count ({proc_count}).")
    if pp_count < 20:
        warnings.append(f"Postprocess '{postprocess_group}' has low sample count ({pp_count}).")
    if postprocess_group != pp_raw:
        warnings.append(f"Postprocess '{pp_raw}' mapped to '{postprocess_group}'.")

    stock_volume = l * w * h
    stock_weight_kg = stock_volume * density / 1_000_000
    material_cost_rmb = stock_weight_kg * price_per_kg
    material_markup = _process_material_markup(process_group)
    setup_fee = _process_setup_fee(process_group)
    machining_base = _process_machining_base(process_group)
    pp_fee = _postprocess_fee(postprocess_group)
    tier, delta = _quantity_tier(quantity)

    material_term = material_cost_rmb * material_markup
    setup_term = setup_fee / quantity
    machining_term = machining_base * DIFFICULTY_FACTOR * tolerance_factor

    raw_unit_price = (material_term + setup_term + machining_term + pp_fee) * delta
    suggested_unit = round(raw_unit_price * SAFETY_MULTIPLIER, 2)
    suggested_total = round(suggested_unit * quantity, 2)

    # ── Estimate band + stable random ──────────
    low_pct, high_pct, risk_level = _estimate_band_policy(
        cat_id, process_group, postprocess_group, quantity,
    )
    today = datetime.utcnow().strftime("%Y-%m-%d")
    seed_parts = [
        payload.get("file_id", payload.get("part_name", "unknown")),
        cat_id, process_group, postprocess_group,
        str(quantity), currency, today,
    ]
    unit_estimate_rmb, seed_info = _stable_estimate_in_band(
        suggested_unit, low_pct, high_pct, seed_parts,
    )

    valid_until = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%d")

    unit_estimate_disp = float(convert_rmb(unit_estimate_rmb, currency))
    total_estimate_disp = float(convert_rmb(unit_estimate_rmb * quantity, currency))

    unit_display = _display_amount(suggested_unit, currency)
    total_display = _display_amount(suggested_total, currency)

    result = {
        "quote_status": "estimated",
        "pricing_mode": "deterministic_calculation",
        "pricing_model_version": "v2.2_estimate",
        "valid_until": valid_until,
        "currency": currency,
        "exchange_rate_basis": "RMB",
        "customer_email": customer_email or None,
        "customer_name": customer_name or None,
        "part": {
            "file_id": payload.get("file_id", ""),
            "name": payload.get("part_name", ""),
            "stp_filename": payload.get("stp_filename", ""),
            "volume_mm3": payload.get("volume_mm3", 0),
            "obb_dimensions_mm": payload.get("obb_dimensions_mm", ""),
            "obb_lwh_mm": [l, w, h],
            "stock_volume_mm3": stock_volume,
            "stock_weight_kg": round(stock_weight_kg, 4),
        },
        "selections": {
            "material": {"id": material["price_id"].strip(),
                "name": material.get("material_grade_norm", material.get("material_base_norm", "")).strip(),
                "density_g_cm3": density, "price_rmb_per_kg": price_per_kg},
            "material_category": cat_id or None,
            "process": process_group,
            "postprocess_group": postprocess_group,
            "postprocess_public_label": postprocess_public_label,
            "quantity": quantity,
            "quantity_tier": tier,
            "tolerance_grade": tolerance_grade,
            "tolerance_label": tolerance_label,
        },
        "formula": {
            "material_cost_rmb": round(material_cost_rmb, 2),
            "material_markup": material_markup,
            "material_term_rmb": round(material_term, 2),
            "setup_fee_rmb": setup_fee,
            "setup_term_rmb": round(setup_term, 2),
            "machining_base_rmb": machining_base,
            "difficulty_factor": DIFFICULTY_FACTOR,
            "tolerance_factor": tolerance_factor,
            "machining_term_rmb": round(machining_term, 2),
            "postprocess_fee_rmb": pp_fee,
            "quantity_delta": delta,
            "raw_unit_price_rmb": round(raw_unit_price, 2),
            "safety_multiplier": SAFETY_MULTIPLIER,
            "suggested_unit_price_rmb": round(suggested_unit, 2),
            "suggested_total_rmb": round(suggested_total, 2),
        },
        "unit_price": {"amount": unit_display, "amount_rmb": round(suggested_unit, 2),
            "currency": currency, "display": f"{currency} {unit_display:,.2f}"},
        "total": {"amount": total_display, "amount_rmb": round(suggested_total, 2),
            "currency": currency, "display": f"{currency} {total_display:,.2f}"},
        "unit_estimate": {
            "amount": unit_estimate_disp,
            "amount_rmb": round(unit_estimate_rmb, 2),
            "currency": currency,
            "display": f"{currency} {unit_estimate_disp:,.2f} / pc",
        },
        "total_estimate": {
            "amount": total_estimate_disp,
            "amount_rmb": round(unit_estimate_rmb * quantity, 2),
            "currency": currency,
            "display": f"{currency} {total_estimate_disp:,.2f}",
        },
        "estimate_band": seed_info,
        "breakdown": [
            {"label": "Material term", "display": f"¥{material_term:.2f} / pc"},
            {"label": "Setup allocation", "display": f"¥{setup_term:.2f} / pc"},
            {"label": "Machining base", "display": f"¥{machining_term:.2f} / pc"},
            {"label": "Postprocess", "display": f"¥{pp_fee:.2f} / pc"},
        ],
        "warnings": warnings,
        "disclaimer": "This is for reference only.",
        "_internal_risk_level": risk_level,
    }
    return result


# ── Commercial rounding ─────────────────────────

def _commercial_round(amount: float) -> float:
    if amount < 10:
        step = 0.5
    elif amount < 100:
        step = 5
    elif amount < 1000:
        step = 10
    elif amount < 10000:
        step = 50
    else:
        step = 100
    return round(amount / step) * step


def _display_amount(rmb: float, currency: str) -> float:
    return float(convert_rmb(rmb, currency))


# ── Public response sanitizer ───────────────────

def public_quote_response(result: dict) -> dict:
    """Strip internal fields, return point estimate for public API."""
    sel = result.get("selections", {})
    mat = sel.get("material", {})
    cat_id = sel.get("material_category")
    display = _public_material_display(material_id=mat.get("id", ""), category_id=cat_id or "")
    return {
        "quote_status": "estimated",
        "valid_until": result.get("valid_until"),
        "currency": result.get("currency"),
        "part": {
            "name": result.get("part", {}).get("name"),
            "stp_filename": result.get("part", {}).get("stp_filename"),
            "obb_dimensions_mm": result.get("part", {}).get("obb_dimensions_mm"),
        },
        "selections": {
            "material_category": display["category"],
            "material": display["material"],
            "process": _process_label(sel.get("process", "")),
            "postprocess_group": sel.get("postprocess_public_label",
                _postprocess_label(sel.get("postprocess_group", ""))),
            "quantity": sel.get("quantity"),
            "tolerance_grade": sel.get("tolerance_label",
                sel.get("tolerance_grade", "")),
        },
        "unit_estimate": result.get("unit_estimate", {}),
        "total_estimate": result.get("total_estimate", {}),
        "warnings": _public_warnings(result.get("warnings", [])),
        "review_note": "For an exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote.",
        "disclaimer": "This estimate is for early cost evaluation. Final pricing may vary based on material grade, tolerances, finishing requirements, inspection needs, and lead time. For an exact quote, contact our engineers for a fast formal review.",
    }


def _public_material_display(material_id: str, category_id: str = "") -> dict:
    """Return public-safe material display info from material_public_options."""
    cats = material_categories()
    cat_label = ""
    mat_label = ""
    for cat in cats.get("categories", []):
        if cat.get("id") == category_id:
            cat_label = cat.get("label", "")
        for m in cat.get("materials", []):
            if m.get("id") == material_id:
                mat_label = m.get("label", "")
                if not cat_label:
                    cat_label = cat.get("label", "")
                break
        if cat_label and mat_label:
            break
    if not mat_label:
        # Fallback: strip CJK from raw name if public options not found
        import re
        mat_label = re.sub(r"[\u4e00-\u9fff]+", "", material_id or "").strip()
    return {"category": cat_label or category_id or "", "material": mat_label or ""}


def _public_warnings(warnings: list[str]) -> list[str]:
    public = []
    for w in warnings:
        if "low sample count" in w.lower():
            public.append("This configuration may require manual engineering review.")
        elif "mapped to" in w.lower():
            continue
        else:
            public.append(w)
    return list(dict.fromkeys(public))
