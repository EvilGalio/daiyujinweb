"""ISO Tolerance calculator facade to tolerance_engine.

Maintains backward compatibility with existing API routes while
delegating to the data-driven engine.
"""

from __future__ import annotations

import re
from typing import Any

from services.tolerance_engine.fit_calc import calculate_fit_result, resolve_dimension
from services.tolerance_engine.capabilities import get_capabilities, get_presets
from services.tolerance_engine.parser import TolError

import json
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "tolerance_engine" / "data"


def _load_json(name: str) -> dict:
    with open(_DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def get_tolerance_zones() -> dict:
    """Return zone data with legacy keys kept for older callers."""
    capabilities = get_capabilities()
    hole_zones = capabilities.get("hole", {}).get("zones", [])
    shaft_zones = capabilities.get("shaft", {}).get("zones", [])
    return {
        "hole_zones": hole_zones,
        "shaft_zones": shaft_zones,
        "grades": capabilities.get("grades", []),
        "zones": sorted(set(hole_zones + shaft_zones)),
    }


def _filter_fit_groups(data: dict, standard: str | None, basis: str | None, fit_type: str | None) -> dict:
    if not any([standard, basis, fit_type]):
        return data

    def norm_token(value: str | None) -> str:
        return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())

    standard_norm = norm_token(standard)
    basis_norm = str(basis or "").strip().lower()
    type_norm = str(fit_type or "").strip().lower()
    filtered: dict[str, Any] = {}

    for group_name, group in data.items():
        if group_name == "legacy":
            continue
        if not isinstance(group, dict):
            filtered[group_name] = group
            continue
        group_out: dict[str, list[dict[str, Any]]] = {}
        for bucket_name, items in group.items():
            if type_norm and bucket_name.lower() != type_norm:
                continue
            kept = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_standard = norm_token(item.get("standard"))
                group_standard = norm_token(group_name)
                item_basis = str(item.get("basis", "")).lower()
                if standard_norm and standard_norm not in item_standard and standard_norm not in group_standard:
                    continue
                if basis_norm and basis_norm != item_basis:
                    continue
                kept.append(item)
            if kept:
                group_out[bucket_name] = kept
        if group_out:
            filtered[group_name] = group_out
    return filtered


def get_tolerance_presets(
    standard: str | None = None,
    basis: str | None = None,
    fit_type: str | None = None,
) -> dict:
    """Return structured grouped presets with a legacy flat list."""
    data = _load_json("preferred_fits.json")
    data = _filter_fit_groups(data, standard, basis, fit_type)
    data["presets"] = get_presets()
    return data


def calculate_fit(basic_size_mm: float, fit_combination: str) -> dict[str, Any]:
    """Legacy fit calculation entry point."""
    return calculate_fit_result(float(basic_size_mm), fit_combination)


def resolve_named_fit(standard: str | None, named_fit: str) -> dict[str, Any]:
    """Resolve a named ANSI fit to the ISO 286 equivalent class pair."""
    standard_text = str(standard or "").strip().lower()
    name_text = " ".join(str(named_fit or "").strip().upper().split())
    if not name_text:
        raise TolError("invalid_named_fit", "Named fit is required")

    data = _load_json("ansi_fits.json")
    for item in data.get("fits", []):
        item_name = str(item.get("name", "")).upper()
        item_standard = str(item.get("standard", "")).lower()
        if item_name != name_text:
            continue
        if standard_text and standard_text not in {"ansi", "ansi_b4_1", "ansi b4.1"}:
            if standard_text not in item_standard:
                continue
        return item

    raise TolError("unsupported_named_fit",
        f"Unsupported named fit '{named_fit}'",
        {"standard": standard, "named_fit": named_fit})


_TOL_CLASS_PATTERN = re.compile(r"^[A-Za-z]{1,2}\d{1,2}$")


def _compose_tolerance(zone: str | None, grade: Any) -> str:
    zone_value = str(zone or "").strip()
    grade_value = str(grade or "").strip()
    if not zone_value or not grade_value:
        return ""
    return f"{zone_value}{grade_value}"


def _to_mode_value(value: Any) -> str:
    return str(value or "").strip().lower()


def _response_single_mode(
    basic_mm: float,
    part: dict[str, Any],
    part_kind: str,
) -> dict[str, Any]:
    if part_kind == "hole":
        hole, shaft = part, None
    else:
        hole, shaft = None, part

    return {
        "mode": part_kind,
        "basic_size_mm": float(basic_mm),
        "size_range": part["size_range"],
        "fit_combination": part["tolerance"],
        "hole": hole,
        "shaft": shaft,
        "fit": None,
    }


def get_tolerance_capabilities() -> dict:
    return get_capabilities()


def calculate_tolerance(params: dict[str, Any]) -> dict[str, Any]:
    """Main calculate entry point. Backward compatible.

    Accepts:
      - {"basic_size_mm": 25, "fit_combination": "H7/g6"}
      - {"basic_size_mm": 25, "hole_tolerance": "H7", "shaft_tolerance": "g6"}
      - {"basic_size_mm": 25, "hole_zone": "H", "hole_grade": 7, "shaft_zone": "g", "shaft_grade": 6}
      - {"basic_size_mm": 10, "single_basis": "shaft", "shaft_zone": "h", "shaft_grade": 6}
    """
    basic_mm = float(params["basic_size_mm"])
    if basic_mm < 1 or basic_mm > 3150:
        raise TolError("invalid_basic_size", "Basic size must be between 1 and 3150 mm")

    fit_raw = params.get("fit_combination", "")
    named_fit = params.get("named_fit")
    standard = params.get("standard")
    hole_tol = params.get("hole_tolerance", "")
    shaft_tol = params.get("shaft_tolerance", "")

    if named_fit:
        alias = resolve_named_fit(standard, str(named_fit))
        result = calculate_fit_result(basic_mm, alias["combination"])
        result["mode"] = "fit"
        result["named_fit"] = alias["name"]
        result["standard"] = alias["standard"]
        result["standard_context"] = alias["calculation_basis"]
        return result

    if not hole_tol and not shaft_tol:
        hole_tol = _compose_tolerance(params.get("hole_zone"), params.get("hole_grade"))
        shaft_tol = _compose_tolerance(params.get("shaft_zone"), params.get("shaft_grade"))

    # Support modern UI payloads where single zone+grade is posted.
    if not hole_tol and not shaft_tol:
        zone = params.get("single_zone") or params.get("zone")
        grade = params.get("single_grade") or params.get("grade")
        basis = _to_mode_value(params.get("single_basis") or params.get("mode"))
        zone = str(zone or "").strip()
        grade = str(grade or "").strip()
        if zone and grade:
            if basis == "shaft":
                shaft_tol = _compose_tolerance(zone, grade)
            elif basis == "hole":
                hole_tol = _compose_tolerance(zone, grade)
    mode = _to_mode_value(params.get("mode"))

    if isinstance(fit_raw, str):
        fit_raw = fit_raw.strip()

    if fit_raw and "/" in fit_raw:
        return {"mode": "fit", **calculate_fit_result(basic_mm, fit_raw)}
    if fit_raw and _TOL_CLASS_PATTERN.match(fit_raw):
        part = resolve_dimension(basic_mm, fit_raw)
        return _response_single_mode(
            basic_mm,
            part,
            part["kind"],
        )
    if hole_tol and shaft_tol:
        fit_raw = f"{hole_tol}/{shaft_tol}"
        return {"mode": "fit", **calculate_fit_result(basic_mm, fit_raw)}
    if hole_tol and not shaft_tol and mode in {"hole", "single"}:
        return _response_single_mode(
            basic_mm,
            resolve_dimension(basic_mm, hole_tol),
            "hole",
        )
    if shaft_tol and not hole_tol and mode in {"shaft", "single"}:
        return _response_single_mode(
            basic_mm,
            resolve_dimension(basic_mm, shaft_tol),
            "shaft",
        )
    if hole_tol and not shaft_tol:
        # auto-detect basis from token when mode is not explicitly set
        part = resolve_dimension(basic_mm, hole_tol)
        return _response_single_mode(basic_mm, part, part["kind"])
    if shaft_tol and not hole_tol:
        part = resolve_dimension(basic_mm, shaft_tol)
        return _response_single_mode(basic_mm, part, part["kind"])
    raise TolError("invalid_request", "Provide fit_combination or hole_tolerance/shaft_tolerance")
