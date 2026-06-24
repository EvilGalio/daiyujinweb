"""Smoke test freight v2 against golden cases from test_freight_workbook_logic.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.freight import calculate_freight


def test():
    results = {}
    errors = []

    # GC1: DHL Germany 5kg (zone 7, CNY 658.50)
    try:
        r = calculate_freight(country="Germany", weight_kg=5, carriers=["DHL"], currency="CNY")
        results["gc1_dhl_germany_5kg"] = {
            "base_freight_cny": r["results"][0]["base_freight"],
            "zone": r["results"][0]["zone"],
            "pricing_mode": r["results"][0]["pricing_mode"],
            "charge_weight": r["results"][0]["charge_weight_kg"],
            "expected_zone_7_price_658.50": r["results"][0]["base_freight"] == 658.50,
        }
    except Exception as e:
        errors.append(f"GC1: {e}")

    # GC2: FedEx Germany 5kg (zone K, CNY 458.54)
    try:
        r = calculate_freight(country="Germany", weight_kg=5, carriers=["FedEx"], currency="CNY")
        results["gc2_fedex_germany_5kg"] = {
            "base_freight_cny": r["results"][0]["base_freight"],
            "zone": r["results"][0]["zone"],
            "pricing_mode": r["results"][0]["pricing_mode"],
            "charge_weight": r["results"][0]["charge_weight_kg"],
            "expected_zone_K_price_458.54": abs(r["results"][0]["base_freight"] - 458.54) < 2,
        }
    except Exception as e:
        errors.append(f"GC2: {e}")

    # GC3: DHL document 1.5kg
    try:
        r = calculate_freight(country="Germany", weight_kg=1.5, carriers=["DHL"], currency="CNY", cargo_type="document")
        results["gc3_dhl_document"] = {
            "base_freight_cny": r["results"][0]["base_freight"],
            "pricing_mode": r["results"][0]["pricing_mode"],
            "charge_weight": r["results"][0]["charge_weight_kg"],
        }
    except Exception as e:
        errors.append(f"GC3: {e}")

    # GC4: DHL heavy 36kg (should be heavy, not small matrix)
    try:
        r = calculate_freight(country="Germany", weight_kg=36, carriers=["DHL"], currency="CNY")
        rr = r["results"][0]
        results["gc4_dhl_heavy_36kg"] = {
            "pricing_mode": rr["pricing_mode"],
            "zone": rr["zone"],
            "base_freight_cny": rr["base_freight"],
            "charge_weight": rr["charge_weight_kg"],
            "packaging_adjusted": rr["packaging_adjusted_weight_kg"],
            "unit_price": rr["unit_price"],
            "expected_heavy_mode": rr["pricing_mode"] == "heavy_per_kg",
            "expected_packaging_43_5": abs((rr["packaging_adjusted_weight_kg"] or 0) - 43.5) < 0.2,
        }
    except Exception as e:
        errors.append(f"GC4: {e}")

    # GC5: FedEx heavy 25kg
    try:
        r = calculate_freight(country="Germany", weight_kg=25, carriers=["FedEx"], currency="CNY")
        rr = r["results"][0]
        results["gc5_fedex_heavy_25kg"] = {
            "pricing_mode": rr["pricing_mode"],
            "zone": rr["zone"],
            "base_freight_cny": rr["base_freight"],
            "charge_weight": rr["charge_weight_kg"],
            "packaging_adjusted": rr["packaging_adjusted_weight_kg"],
            "unit_price": rr["unit_price"],
            "expected_heavy_mode": rr["pricing_mode"] == "heavy_per_kg",
            "expected_packaging_29": abs((rr["packaging_adjusted_weight_kg"] or 0) - 29) < 0.2,
        }
    except Exception as e:
        errors.append(f"GC5: {e}")

    # GC6: USD default
    try:
        r = calculate_freight(country="Germany", weight_kg=5, carriers=["DHL", "FedEx"])
        results["gc6_usd_default"] = {
            "display_currency": r["currency"],
            "carriers": [x["carrier"] for x in r["results"]],
            "converted_totals_usd": [x["converted_total"] for x in r["results"]],
        }
    except Exception as e:
        errors.append(f"GC6: {e}")

    # GC7: Advanced volumetric
    try:
        r = calculate_freight(
            country="Germany", weight_kg=5, carriers=["DHL"], currency="CNY",
            actual_weight_kg=5,
            advanced={"boxes": 1, "dimensions": {"length_cm": 50, "width_cm": 40, "height_cm": 30}},
        )
        results["gc7_volumetric"] = {
            "volumetric_weight": r["inputs"]["volumetric_weight_kg"],
            "billable_base": r["results"][0]["billable_weight_kg"],
            "expected_vol_12": abs((r["inputs"]["volumetric_weight_kg"] or 0) - 12.0) < 0.1,
        }
    except Exception as e:
        errors.append(f"GC7: {e}")

    print(json.dumps(results, indent=2, ensure_ascii=False))
    if errors:
        print(f"\nERRORS: {errors}")


if __name__ == "__main__":
    test()
