"""ISO Tolerance calculator — facade to tolerance_engine.

Maintains backward compatibility with existing API routes while
delegating to the data-driven engine.
"""

from __future__ import annotations

from typing import Any

from services.tolerance_engine.fit_calc import calculate_fit_result, resolve_dimension
from services.tolerance_engine.capabilities import get_capabilities, get_presets, get_zones
from services.tolerance_engine.parser import TolError


def get_tolerance_zones() -> list[str]:
    return get_zones()


def get_tolerance_presets() -> list[str]:
    return get_presets()


def get_tolerance_capabilities() -> dict:
    return get_capabilities()


def calculate_tolerance(params: dict[str, Any]) -> dict[str, Any]:
    """Main calculate entry point. Backward compatible.

    Accepts:
      - {"basic_size_mm": 25, "fit_combination": "H7/g6"}
      - {"basic_size_mm": 25, "hole_tolerance": "H7", "shaft_tolerance": "g6"}
    """
    basic_mm = float(params["basic_size_mm"])
    if basic_mm < 1 or basic_mm > 500:
        raise TolError("invalid_basic_size", "Basic size must be 1–500 mm")

    fit_raw = params.get("fit_combination", "")
    hole_tol = params.get("hole_tolerance", "")
    shaft_tol = params.get("shaft_tolerance", "")

    if fit_raw:
        return calculate_fit_result(basic_mm, fit_raw)
    elif hole_tol and shaft_tol:
        fit_raw = f"{hole_tol}/{shaft_tol}"
        return calculate_fit_result(basic_mm, fit_raw)
    elif hole_tol:
        return resolve_dimension(basic_mm, hole_tol)
    elif shaft_tol:
        return resolve_dimension(basic_mm, shaft_tol)
    else:
        raise TolError("invalid_request", "Provide fit_combination or hole_tolerance/shaft_tolerance")
