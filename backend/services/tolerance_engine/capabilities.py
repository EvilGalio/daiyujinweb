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
    for name in ["public_rules", "preferred_classes", "preferred_fits"]:
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

    return {
        "engine": {"version": "iso286-reference-v2", "coverage_mode": "public_minimal"},
        "size_range_mm": {"min": 1, "max": 500},
        "grades": [f"IT{i}" for i in range(0, 19)] + ["IT01"],
        "hole": {
            "zones": hole_zones,
            "classes": [c["code"] for c in classes["hole"]],
        },
        "shaft": {
            "zones": shaft_zones,
            "classes": [c["code"] for c in classes["shaft"]],
        },
        "presets": pkg["preferred_fits"],
    }


def get_presets() -> list[str]:
    pkg = _load()
    fits = pkg["preferred_fits"].get("hole_basis", {})
    all_fits = []
    for category in ["clearance", "transition", "interference"]:
        all_fits.extend(fits.get(category, []))
    return all_fits or ["H7/g6", "H7/h6", "H6/k5", "H7/p6", "H8/f7"]


def get_zones() -> list[str]:
    pkg = _load()
    rules = pkg["public_rules"]["rules"]
    return sorted(set(r["zone"] for r in rules))
