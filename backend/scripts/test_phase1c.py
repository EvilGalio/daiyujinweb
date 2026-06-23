from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import create_app
from services.tolerance import calculate_fit, get_tolerance_presets, get_tolerance_zones


def main() -> int:
    zones = get_tolerance_zones()
    assert "H" in zones["hole_zones"]
    assert "g" in zones["shaft_zones"]
    assert "IT7" in zones["grades"]
    assert "H6/k5" in get_tolerance_presets()["presets"]

    transition = calculate_fit(25, "H6/k5")
    assert transition["size_range"] == "18-30"
    assert transition["hole"]["it_um"] == 13
    assert transition["hole"]["lower_deviation_um"] == 0
    assert transition["hole"]["upper_deviation_um"] == 13
    assert transition["shaft"]["it_um"] == 9
    assert transition["shaft"]["lower_deviation_um"] == 2
    assert transition["shaft"]["upper_deviation_um"] == 11
    assert transition["fit"]["type"] == "transition"
    assert transition["fit"]["max_clearance_um"] == 11
    assert transition["fit"]["max_interference_um"] == 11

    clearance = calculate_fit(25, "H7/g6")
    assert clearance["hole"]["upper_deviation_um"] == 21
    assert clearance["shaft"]["upper_deviation_um"] == -7
    assert clearance["shaft"]["lower_deviation_um"] == -20
    assert clearance["fit"]["type"] == "clearance"
    assert clearance["fit"]["max_clearance_um"] == 41
    assert clearance["fit"]["max_interference_um"] == 0

    interference = calculate_fit(25, "H7/p6")
    assert interference["shaft"]["lower_deviation_um"] == 22
    assert interference["shaft"]["upper_deviation_um"] == 35
    assert interference["fit"]["type"] == "interference"
    assert interference["fit"]["max_clearance_um"] == 0
    assert interference["fit"]["max_interference_um"] == 35

    assert calculate_fit(18, "H7/h6")["size_range"] == "10-18"
    assert calculate_fit(1500, "H7/h6")["size_range"] == "1250-1600"

    app = create_app()
    client = app.test_client()
    response = client.post(
        "/api/public/tolerance/calculate",
        json={"basic_size_mm": 25, "fit_combination": "H7/g6"},
    )
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["fit"]["type"] == "clearance"

    bad_response = client.post(
        "/api/public/tolerance/calculate",
        json={"basic_size_mm": 25, "fit_combination": "H7/z6"},
    )
    assert bad_response.status_code == 400
    assert bad_response.get_json()["code"] == "invalid_tolerance_request"

    print("phase 1C smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
