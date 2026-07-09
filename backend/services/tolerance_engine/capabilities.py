"""Capabilities endpoint data."""
from __future__ import annotations

import json
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"
_cache = None


def _load():
    global _cache
    if _cache is not None:
        return _cache
    pkg = {}
    for name in ["public_rules", "preferred_classes", "preferred_fits", "reference_fit_catalog", "ansi_fits"]:
        with open(_DATA_DIR / f"{name}.json", encoding="utf-8") as f:
            pkg[name] = json.load(f)
    _cache = pkg
    return pkg


def get_capabilities() -> dict:
    pkg = _load()
    rules = pkg["public_rules"]["rules"]
    classes = pkg["preferred_classes"]

    hole_zones = sorted(set(r["zone"] for r in rules if r["kind"] == "hole"))
    shaft_zones = sorted(set(r["zone"] for r in rules if r["kind"] == "shaft"))
    reference_codes = set()
    for group_name, codes in pkg["reference_fit_catalog"].get("groups", {}).items():
        if group_name == "ambiguous_excluded":
            continue
        reference_codes.update(codes)

    return {
        "engine": {"version": "iso286-reference-v3", "coverage_mode": "curated_reference"},
        "size_range_mm": {"min": 1, "max": 3150},
        "grades": [f"IT{i}" for i in range(0, 19)] + ["IT01"],
        "standards": ["ISO 286", "ANSI B4.1 equivalent", "ANSI B4.2 equivalent"],
        "coverage": {
            "fit_catalog_total": len(reference_codes),
            "fit_catalog_calculable": len(reference_codes),
            "unsupported_count": 0,
        },
        "named_fit_groups": ["iso_hole_basis", "iso_shaft_basis", "ansi_b4_1", "ansi_b4_2"],
        "hole": {
            "zones": hole_zones,
            "classes": [c["code"] for c in classes["hole"]],
        },
        "shaft": {
            "zones": shaft_zones,
            "classes": [c["code"] for c in classes["shaft"]],
        },
        "ansi_named_fits": pkg["ansi_fits"].get("fits", []),
        "presets": pkg["preferred_fits"],
    }


def get_presets() -> list[str]:
    pkg = _load()
    all_fits = []
    seen = set()
    for group_name, fits in pkg["preferred_fits"].items():
        if group_name == "legacy" or not isinstance(fits, dict):
            continue
        for category in ["clearance", "transition", "interference"]:
            items = fits.get(category, [])
            for item in items:
                code = item["code"] if isinstance(item, dict) else item
                if code not in seen:
                    seen.add(code)
                    all_fits.append(code)
    return all_fits or ["H7/g6", "H7/h6", "H6/k5", "H7/p6", "H8/f7"]


def get_zones() -> list[str]:
    pkg = _load()
    rules = pkg["public_rules"]["rules"]
    return sorted(set(r["zone"] for r in rules))
