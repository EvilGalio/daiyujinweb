"""Acceptance tests for Quote Calculator v2.1.

Run: D:\\anaconda\\python.exe backend\\scripts\\test_quote_v2.py
"""

import sys, json
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from services.quote_calculator_v2 import (
    calculate_quote_v2, get_quote_options_v2,
    parse_obb_dimensions, _find_material, _find_process,
    _find_postprocess, coefficients, materials,
    SAFETY_MULTIPLIER,
)

errors = []

def check(label, actual, expected, tol=0.01):
    ok = abs(actual - expected) < tol if isinstance(expected, (int, float)) else actual == expected
    if not ok:
        errors.append(f"  FAIL {label}: expected {expected}, got {actual}")
    else:
        print(f"  OK {label}: {actual}")

# ── Phase 1: Formula golden cases ──
print("=== Golden cases ===")

# GC1: AISI 304 + CNC + Deburr + 100x50x20 + qty 10
r = calculate_quote_v2({
    "material_id": "AISI 304", "process": "CNC",
    "postprocess_group": "去毛刺", "quantity": 10,
    "obb_dimensions_mm": "100 x 50 x 20", "currency": "CNY",
})
check("GC1 suggested_unit_price_rmb", r["formula"]["suggested_unit_price_rmb"], 239.75)
check("GC1 total RMB", r["total"]["amount_rmb"], 2397.5)
check("GC1 pricing_mode", r["pricing_mode"], "deterministic_calculation")

# GC2: Al 6061 + 车床 + 阳极氧化 + 50x30x10 + qty 1000
r = calculate_quote_v2({
    "material_id": "Al 6061", "process": "车床",
    "postprocess_group": "阳极氧化", "quantity": 1000,
    "obb_dimensions_mm": "50 x 30 x 10", "currency": "CNY",
})
check("GC2 suggested_unit_price_rmb", r["formula"]["suggested_unit_price_rmb"], 15.24)
check("GC2 tier", r["selections"]["quantity_tier"], "q_501_plus")

# ── Phase 2: Error cases ──
print("=== Error handling ===")

# Missing OBB
try:
    calculate_quote_v2({"material_id": "AISI 304", "process": "CNC", "quantity": 10})
    errors.append("  FAIL: Missing OBB should raise ValueError")
except ValueError as e:
    print(f"  OK Missing OBB: {e}")

# Unknown currency
try:
    calculate_quote_v2({"material_id": "AISI 304", "process": "CNC", "quantity": 10,
        "obb_dimensions_mm": "100 x 50 x 20", "currency": "JPY"})
    errors.append("  FAIL: JPY should raise ValueError")
except ValueError as e:
    print(f"  OK Unknown currency: {e}")

# ── Phase 3: Alias resolution ──
print("=== Alias resolution ===")

process = _find_process("CNC加工")
check("Process alias", process, "CNC")

pp = _find_postprocess("Anodize")
check("Postprocess alias", pp, "阳极氧化")

# ── Phase 4: Deterministic output ──
print("=== Determinism ===")
r1 = calculate_quote_v2({
    "material_id": "AISI 304", "process": "CNC",
    "postprocess_group": "去毛刺", "quantity": 10,
    "obb_dimensions_mm": "100 x 50 x 20",
})
r2 = calculate_quote_v2({
    "material_id": "AISI 304", "process": "CNC",
    "postprocess_group": "去毛刺", "quantity": 10,
    "obb_dimensions_mm": "100 x 50 x 20",
})
check("Deterministic", r1["total"]["amount"], r2["total"]["amount"])

# ── Phase 5: Options endpoint ──
print("=== Options ===")
opts = get_quote_options_v2()
print(f"  Materials: {len(opts['materials'])}")
print(f"  Processes: {[p['label'] for p in opts['processes']]}")
print(f"  Postprocess labels: {[p['label'] for p in opts['postprocess_groups']]}")
# Check no sensitive fields leaked to public options
for pp in opts["postprocess_groups"]:
    if "fee_rmb" in pp or "sample_count" in pp:
        errors.append(f"FAIL: postprocess_groups leaked internal field: {pp}")
print("  Public sanitization: OK (no internal fields in options)")

print()
if errors:
    print(f"{len(errors)} FAILURES:")
    for e in errors:
        print(e)
else:
    print("All tests passed.")

sys.exit(len(errors))
