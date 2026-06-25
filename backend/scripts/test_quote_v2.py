"""Acceptance tests for Quote Calculator v2.1 — material categories + range format."""

import sys, json
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from services.quote_calculator_v2 import (
    calculate_quote_v2, get_quote_options_v2,
    public_quote_response, _commercial_round, _find_material,
    _find_process, _find_postprocess, material_categories,
    SAFETY_MULTIPLIER,
)

errors = []

def check(label, actual, expected, tol=0.01):
    ok = abs(actual - expected) < tol if isinstance(expected, (int, float)) else actual == expected
    if not ok:
        errors.append(f"  FAIL {label}: expected {expected}, got {actual}")
    else:
        print(f"  OK {label}: {actual}")

# GC1
print("=== Golden cases ===")
r = calculate_quote_v2({
    "material_category": "stainless_steel", "process": "CNC",
    "postprocess_group": "去毛刺", "quantity": 10,
    "obb_dimensions_mm": "100 x 50 x 20", "currency": "CNY",
})
check("GC1 suggested_unit_price_rmb", r["formula"]["suggested_unit_price_rmb"], 239.75)
check("GC1 total RMB", r["formula"]["suggested_total_rmb"], 2397.5)

r = calculate_quote_v2({
    "material_category": "aluminum_alloy", "process": "车床",
    "postprocess_group": "阳极氧化", "quantity": 1000,
    "obb_dimensions_mm": "50 x 30 x 10", "currency": "CNY",
})
check("GC2 tier", r["selections"]["quantity_tier"], "q_501_plus")

# Error handling
print("=== Error handling ===")
try: calculate_quote_v2({"process":"CNC","quantity":10})
except ValueError: print("  OK Missing material: ValueError")

try: calculate_quote_v2({"material_category":"aluminum_alloy","process":"CNC","quantity":10,"currency":"JPY",
    "obb_dimensions_mm":"100x50x20"})
except ValueError: print("  OK Unknown currency: ValueError")

# Alias
print("=== Aliases ===")
check("Process alias", _find_process("CNC加工"), "CNC")
check("Postprocess alias", _find_postprocess("Anodize"), "阳极氧化")

# Determinism
print("=== Determinism ===")
r1 = calculate_quote_v2({
    "material_category": "aluminum_alloy", "process": "CNC",
    "postprocess_group": "去毛刺", "quantity": 10,
    "obb_dimensions_mm": "100 x 50 x 20", "currency": "CNY",
})
r2 = calculate_quote_v2({
    "material_category": "aluminum_alloy", "process": "CNC",
    "postprocess_group": "去毛刺", "quantity": 10,
    "obb_dimensions_mm": "100 x 50 x 20", "currency": "CNY",
})
check("Deterministic range", r1["total_range"]["min"], r2["total_range"]["min"])

# Options sanitization
print("=== Options ===")
opts = get_quote_options_v2()
cats = opts.get("material_categories", [])
print(f"  Material categories: {len(cats)}")
for c in cats:
    if "representative_material_id" in c: errors.append(f"Leaked representative in {c}")
    if "range_multiplier" in c: errors.append(f"Leaked multiplier in {c}")
print(f"  Category sanitization: {'OK' if not errors else 'FAIL'}")

# Range format
print("=== Range format ===")
tr, ur = r1["total_range"], r1["unit_range"]
check("min < max", tr["min"] < tr["max"], True)
check("unit min < max", ur["min"] < ur["max"], True)
check("has display", "\u2013" in tr["display"], True)

# Public response
print("=== Public response ===")
pub = public_quote_response(r1)
for banned in ["formula", "breakdown", "amount_rmb", "representative_material_id", "range_multiplier"]:
    if banned in json.dumps(pub):
        errors.append(f"BANNED field in public response: {banned}")
print(f"  Public sanitization: {'OK' if not any(b in json.dumps(pub) for b in ['formula','breakdown','amount_rmb']) else 'FAIL'}")
print(f"  Has unit_range: {bool(pub.get('unit_range'))}")
print(f"  Has total_range: {bool(pub.get('total_range'))}")

# Commercial rounding
print("=== Rounding ===")
check("round 237", _commercial_round(237.42), 240)
check("round 356", _commercial_round(356.13), 360)
check("round 1227", _commercial_round(1227.8), 1250)
check("round 1841", _commercial_round(1841.7), 1850)

# Category config validation
print("=== Config ===")
cats = material_categories()
for key, cat in cats.items():
    mat_id = cat.get("representative_material_id", "")
    try:
        _find_material(mat_id)
        print(f"  {key}: {mat_id} OK")
    except ValueError:
        errors.append(f"Representative material not found: {key} -> {mat_id}")

print()
if errors:
    print(f"{len(errors)} FAILURES:")
    for e in errors:
        print(e)
else:
    print("All tests passed.")
sys.exit(len(errors))
