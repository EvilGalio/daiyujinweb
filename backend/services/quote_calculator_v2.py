"""Quote Calculator v2.1 — frozen additive formula.

Loads coefficient and material files from backend/data/quote_model_v2_1/
and computes deterministic quotes using the v2.1 additive formula.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "quote_model_v2_1"
SAFETY_MULTIPLIER = 1.25
DIFFICULTY_FACTOR = 1.0
MAX_RANGE_MULTIPLIER = 2.20


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
    return _load_json("coefficients_v2_1.json")


def materials() -> list[dict]:
    return _load_csv("materials.csv")


def material_categories() -> dict:
    return _load_json("material_categories.json")


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

def _find_material(material_id: str) -> dict:
    mat_list = materials()
    for m in mat_list:
        if m.get("is_active", "1") != "0" and m["material_norm"].strip() == material_id.strip():
            return m
    # Try alias match
    aliases = _load_csv("material_aliases.csv")
    for a in aliases:
        if a.get("alias", "").strip() == material_id.strip():
            resolved = a.get("material_norm", "").strip()
            for m in mat_list:
                if m["material_norm"].strip() == resolved:
                    return m
    raise ValueError(f"Unsupported material: {material_id!r}")


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
    # 1. Direct match in coefficients (group name)
    if postprocess_id in coef.get("postprocess_fee_by_group", {}):
        return postprocess_id

    # 2. Alias → postprocess_norm
    aliases = _load_csv("postprocess_aliases.csv")
    norm = None
    for a in aliases:
        if a.get("alias", "").strip() == postprocess_id.strip():
            norm = a.get("postprocess_norm", "").strip()
            break

    # 3. postprocess_norm → group (from postprocess_groups.csv)
    if norm:
        groups_csv = _load_csv("postprocess_groups.csv")
        for g in groups_csv:
            if g.get("postprocess_norm", "").strip() == norm:
                group = g.get("postprocess_group", "").strip()
                if group in coef.get("postprocess_fee_by_group", {}):
                    return group

    # 4. Fallback: 其他后处理
    fallback = "\u5176\u4ed6\u540e\u5904\u7406"  # 其他后处理
    if fallback in coef.get("postprocess_fee_by_group", {}):
        return fallback
    raise ValueError(f"Unsupported postprocess: {postprocess_id!r}")


# ── Material markup lookup ──────────────────────

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
    "\u8f66\u5e8a": "Turning",
    "\u8f66\u94e3\u590d\u5408": "Mill-Turn Machining",
    "\u677f\u91d1": "Sheet Metal Fabrication",
}

_POSTPROCESS_LABELS = {
    "\u53bb\u6bdb\u523a": "Deburring",
    "\u949d\u5316": "Passivation",
    "\u7535\u89e3\u629b\u5149": "Electropolishing",
    "\u55b7\u7802\u629b\u5149": "Bead Blasting / Polishing",
    "\u9633\u6781\u6c27\u5316": "Anodizing",
    "\u956d\u96d5": "Laser Marking",
    "\u70ed\u5904\u7406": "Heat Treatment",
    "\u7535\u9540\u6d82\u5c42": "Plating / Coating",
}


def _process_label(pg: str) -> str:
    return _PROCESS_LABELS.get(pg, pg)


def _postprocess_label(pg: str) -> str:
    return _POSTPROCESS_LABELS.get(pg, pg)


# ── Main calculate ──────────────────────────────

def get_quote_options_v2() -> dict:
    coef = coefficients()
    cats = material_categories()

    mat_cats = []
    for key in ["aluminum_alloy", "stainless_steel", "carbon_alloy_steel",
                "engineering_plastic", "brass_copper", "high_performance_plastic", "specialty_metal"]:
        if key in cats and cats[key].get("public"):
            mat_cats.append({
                "id": key,
                "label": cats[key]["label"],
                "description": cats[key].get("description", ""),
            })

    procs = []
    for pg in coef.get("material_markup_by_process", {}):
        if pg == "\u5176\u4ed6\u5de5\u827a":
            continue
        procs.append({"id": pg, "label": _process_label(pg)})

    pp_groups = []
    for pg in coef.get("postprocess_fee_by_group", {}):
        if pg in ("\u672a\u6807\u6ce8\u540e\u5904\u7406", "\u5176\u4ed6\u540e\u5904\u7406"):
            continue
        pp_groups.append({"id": pg, "label": _postprocess_label(pg)})

    return {
        "material_categories": mat_cats,
        "processes": procs,
        "postprocess_groups": pp_groups,
        "tolerance_grades": [{"grade": "GENERAL", "label": "General Tolerance"}],
        "currencies": ["USD", "CNY", "EUR"],
        "default_currency": "USD",
    }


def calculate_quote_v2(payload: dict) -> dict:
    quantity = int(payload.get("quantity", 1))
    if quantity < 1 or quantity > 100000:
        raise ValueError("Quantity must be 1–100,000")
    dims = parse_obb_dimensions(payload.get("obb_dimensions_mm", ""))
    l, w, h = dims
    cat_id = payload.get("material_category", "")
    mat_id = payload.get("material_id", "")
    cats = material_categories()
    range_multiplier = 1.50
    cat_info = None
    if cat_id and cat_id in cats:
        cat_info = cats[cat_id]
        material_id = cat_info["representative_material_id"]
        range_multiplier = float(cat_info.get("range_multiplier", 1.50))
    elif mat_id:
        material_id = str(mat_id)
    else:
        raise ValueError("Provide material_category or material_id")
    material = _find_material(material_id)
    density = float(material["density_g_cm3"])
    price_per_kg = float(material["price_rmb_per_kg"])
    process_raw = str(payload.get("process", "CNC"))
    process_group = _find_process(process_raw)
    pp_raw = str(payload.get("postprocess_group", "去毛刺"))
    postprocess_group = _find_postprocess(pp_raw)
    currency = str(payload.get("currency", "USD")).upper()
    if currency not in ("CNY", "USD", "EUR"):
        raise ValueError(f"Unsupported currency: {currency!r}. Supported: CNY, USD, EUR.")
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
    machining_term = machining_base * DIFFICULTY_FACTOR
    raw_unit_price = (material_term + setup_term + machining_term + pp_fee) * delta
    suggested_unit = round(raw_unit_price * SAFETY_MULTIPLIER, 2)
    suggested_total = round(suggested_unit * quantity, 2)
    usd_cny = 7.20
    usd_eur = 0.92
    if currency == "CNY":
        unit_display = round(suggested_unit, 2)
        total_display = round(suggested_total, 2)
    elif currency == "EUR":
        unit_display = round(suggested_unit / usd_cny * usd_eur, 2)
        total_display = round(suggested_total / usd_cny * usd_eur, 2)
    else:
        unit_display = round(suggested_unit / usd_cny, 2)
        total_display = round(suggested_total / usd_cny, 2)
    valid_until = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%d")
    if process_group == "板金":
        range_multiplier += 0.10
    if postprocess_group in ("热处理", "电镀涂层"):
        range_multiplier += 0.10
    if quantity >= 501:
        range_multiplier += 0.05
    range_multiplier = min(range_multiplier, MAX_RANGE_MULTIPLIER)
    unit_min = _commercial_round(suggested_unit)
    unit_max = _commercial_round(suggested_unit * range_multiplier)
    if unit_max < unit_min * 1.25:
        unit_max = _commercial_round(suggested_unit * 1.25)
    total_min = _commercial_round(suggested_total)
    total_max = _commercial_round(suggested_total * range_multiplier)
    if total_max < total_min * 1.25:
        total_max = _commercial_round(suggested_total * 1.25)
    unit_min_disp = _display_amount(unit_min, currency, usd_cny, usd_eur)
    unit_max_disp = _display_amount(unit_max, currency, usd_cny, usd_eur)
    total_min_disp = _display_amount(total_min, currency, usd_cny, usd_eur)
    total_max_disp = _display_amount(total_max, currency, usd_cny, usd_eur)
    result = {
        "quote_status": "estimated",
        "pricing_mode": "deterministic_calculation",
        "pricing_model_version": "v2.1_additive",
        "valid_until": valid_until,
        "currency": currency,
        "exchange_rate_basis": "RMB",
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
            "material": {"id": material["material_norm"].strip(), "name": material["material_norm"].strip(),
                "density_g_cm3": density, "price_rmb_per_kg": price_per_kg},
            "material_category": cat_id or None,
            "process": process_group, "postprocess_group": postprocess_group,
            "quantity": quantity, "quantity_tier": tier,
            "tolerance_grade": payload.get("tolerance_grade", "GENERAL"),
        },
        "formula": {
            "material_cost_rmb": round(material_cost_rmb, 2), "material_markup": material_markup,
            "material_term_rmb": round(material_term, 2), "setup_fee_rmb": setup_fee,
            "setup_term_rmb": round(setup_term, 2), "machining_base_rmb": machining_base,
            "difficulty_factor": DIFFICULTY_FACTOR, "machining_term_rmb": round(machining_term, 2),
            "postprocess_fee_rmb": pp_fee, "quantity_delta": delta,
            "raw_unit_price_rmb": round(raw_unit_price, 2), "safety_multiplier": SAFETY_MULTIPLIER,
            "suggested_unit_price_rmb": round(suggested_unit, 2),
            "suggested_total_rmb": round(suggested_total, 2),
        },
        "unit_price": {"amount": unit_display, "amount_rmb": round(suggested_unit, 2),
            "currency": currency, "display": f"{currency} {unit_display:,.2f}"},
        "total": {"amount": total_display, "amount_rmb": round(suggested_total, 2),
            "currency": currency, "display": f"{currency} {total_display:,.2f}"},
        "breakdown": [
            {"label": "Material term", "display": f"¥{material_term:.2f} / pc"},
            {"label": "Setup allocation", "display": f"¥{setup_term:.2f} / pc"},
            {"label": "Machining base", "display": f"¥{machining_term:.2f} / pc"},
            {"label": "Postprocess", "display": f"¥{pp_fee:.2f} / pc"},
        ],
        "warnings": warnings,
        "unit_range": {"min": unit_min_disp, "max": unit_max_disp,
            "currency": currency, "display": f"{currency} {unit_min_disp:,} – {unit_max_disp:,} / pc"},
        "total_range": {"min": total_min_disp, "max": total_max_disp,
            "currency": currency, "display": f"{currency} {total_min_disp:,} – {total_max_disp:,}"},
        "disclaimer": "This is for reference only.",
        "_internal_range_multiplier": range_multiplier,
        "_internal_representative_material": material_id,
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


def _display_amount(rmb: float, currency: str, usd_cny: float, usd_eur: float) -> float:
    if currency == "CNY":
        return rmb
    elif currency == "EUR":
        return rmb / usd_cny * usd_eur
    else:
        return rmb / usd_cny


# ── Public response sanitizer ───────────────────

def public_quote_response(result: dict) -> dict:
    """Strip internal fields from the public API response."""
    sel = result.get("selections", {})
    mat = sel.get("material", {})
    cat_id = sel.get("material_category")
    cat_info = material_categories().get(cat_id or "", {})
    return {
        "quote_status": "estimated_range",
        "valid_until": result.get("valid_until"),
        "currency": result.get("currency"),
        "part": {
            "name": result.get("part", {}).get("name"),
            "stp_filename": result.get("part", {}).get("stp_filename"),
            "obb_dimensions_mm": result.get("part", {}).get("obb_dimensions_mm"),
        },
        "selections": {
            "material_category": {
                "id": cat_id or mat.get("id"),
                "label": cat_info.get("label") or mat.get("name", ""),
            },
            "process": _process_label(sel.get("process", "")),
            "postprocess_group": _postprocess_label(sel.get("postprocess_group", "")),
            "quantity": sel.get("quantity"),
            "tolerance_grade": sel.get("tolerance_grade"),
        },
        "unit_range": result.get("unit_range", {}),
        "total_range": result.get("total_range", {}),
        "warnings": _public_warnings(result.get("warnings", [])),
        "review_note": "For exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote.",
        "disclaimer": "This range is for early cost evaluation. Exact pricing depends on material grade, tolerance, finish, and lead time.",
    }


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
