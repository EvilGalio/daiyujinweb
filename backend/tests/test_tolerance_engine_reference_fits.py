from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.tolerance import calculate_fit, calculate_tolerance

DATA_DIR = BACKEND_ROOT / "services" / "tolerance_engine" / "data"


def _load_json(name: str) -> dict:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def _reference_codes() -> list[str]:
    data = _load_json("reference_fit_catalog.json")
    codes: set[str] = set()
    for group_name, group in data.get("groups", {}).items():
        if group_name == "ambiguous_excluded":
            continue
        codes.update(group)
    return sorted(codes)


def _sample_sizes() -> list[float]:
    return [25.0, 50.0, 100.0]


def _calculate_at_supported_size(code: str) -> dict:
    errors = []
    for size in _sample_sizes():
        try:
            return calculate_fit(size, code)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{size:g} mm: {exc}")
    raise AssertionError(f"{code} failed at all sample sizes: {'; '.join(errors)}")


def test_reference_fit_catalog_is_calculable() -> None:
    for code in _reference_codes():
        result = _calculate_at_supported_size(code)
        assert result["hole"]["min_size_mm"] <= result["hole"]["max_size_mm"]
        assert result["shaft"]["min_size_mm"] <= result["shaft"]["max_size_mm"]
        assert result["fit"]["type"] in {"clearance", "transition", "interference"}
        assert result["fit"]["allowance_um"] == result["allowance_um"]


def test_named_ansi_aliases_resolve() -> None:
    cases = [
        ("RC 3", "H7/f6"),
        ("LC 2", "H7/h6"),
        ("FN 3", "H7/t6"),
    ]
    for name, expected in cases:
        result = calculate_tolerance({
            "basic_size_mm": 50,
            "standard": "ansi_b4_1",
            "named_fit": name,
        })
        assert result["fit_combination"] == expected
        assert result["standard_context"] == "iso286_equivalent"


def test_custom_selector_values_change_result() -> None:
    loose = calculate_tolerance({
        "basic_size_mm": 25,
        "hole_tolerance": "H7",
        "shaft_tolerance": "g6",
    })
    tight = calculate_tolerance({
        "basic_size_mm": 25,
        "hole_tolerance": "H7",
        "shaft_tolerance": "m6",
    })
    assert loose["fit"]["type"] != tight["fit"]["type"]
    assert loose["allowance_um"] != tight["allowance_um"]
