"""Dimension builder and fit calculator."""
from __future__ import annotations

from .parser import parse_class, parse_fit
from .it_grade import it_width
from .deviation import resolve


def resolve_dimension(basic_mm: float, tolerance_raw: str) -> dict:
    """Compute full dimension result for a single tolerance class."""
    parsed = parse_class(tolerance_raw)
    kind, zone, grade_num, norm = parsed["kind"], parsed["zone"], parsed["grade"], parsed["normalized"]
    grade_label = f"IT{grade_num}"

    it = it_width(basic_mm, grade_num)
    dev = resolve(basic_mm, it["size_range"], kind, zone, it["tolerance_width_um"], grade_num)

    lo_dev = dev["lower_um"]
    up_dev = dev["upper_um"]
    min_size = round(basic_mm + lo_dev / 1000, 4)
    max_size = round(basic_mm + up_dev / 1000, 4)

    return {
        "kind": kind,
        "tolerance": norm,
        "zone": zone,
        "grade": grade_label,
        "basic_size_mm": basic_mm,
        "size_range": it["size_range"],
        "tolerance_width_um": it["tolerance_width_um"],
        "lower_deviation_um": lo_dev,
        "upper_deviation_um": up_dev,
        "lower_symbol": dev["lower_sym"],
        "upper_symbol": dev["upper_sym"],
        "min_size_mm": min_size,
        "max_size_mm": max_size,
        "it_um": it["tolerance_width_um"],
    }


def calculate_fit_result(basic_mm: float, fit_raw: str) -> dict:
    """Compute full fit result."""
    parsed = parse_fit(fit_raw)
    hole = resolve_dimension(basic_mm, parsed["hole"]["normalized"])
    shaft = resolve_dimension(basic_mm, parsed["shaft"]["normalized"])

    # Clearance window
    hole_min_um = hole["lower_deviation_um"]
    hole_max_um = hole["upper_deviation_um"]
    shaft_min_um = shaft["lower_deviation_um"]
    shaft_max_um = shaft["upper_deviation_um"]

    max_clr = hole_max_um - shaft_min_um
    min_clr = hole_min_um - shaft_max_um
    max_int = max(0, shaft_max_um - hole_min_um)
    allowance_um = min_clr

    # Fit classification
    if min_clr >= 0:
        fit_type = "clearance"
        label = "Clearance fit"
    elif max_clr <= 0:
        fit_type = "interference"
        label = "Interference fit"
        max_clr = 0
    else:
        fit_type = "transition"
        label = "Transition fit"

    clearance_um = {"min": min_clr, "max": max_clr}
    interference_um = {"max": max_int}
    hole_limits_mm = {"lower": hole["min_size_mm"], "upper": hole["max_size_mm"]}
    shaft_limits_mm = {"lower": shaft["min_size_mm"], "upper": shaft["max_size_mm"]}

    return {
        "basic_size_mm": float(basic_mm),
        "size_range": hole["size_range"],
        "fit_combination": parsed["fit_combination"],
        "hole": hole,
        "shaft": shaft,
        "allowance_um": allowance_um,
        "fit_classification": fit_type,
        "hole_limits_mm": hole_limits_mm,
        "shaft_limits_mm": shaft_limits_mm,
        "clearance_um": clearance_um,
        "interference_um": interference_um,
        "fit": {
            "type": fit_type,
            "label": label,
            "min_clearance_um": min_clr,
            "max_clearance_um": max_clr,
            "max_interference_um": max_int,
            "allowance_um": allowance_um,
            "clearance_um": clearance_um,
            "interference_um": interference_um,
        },
    }
