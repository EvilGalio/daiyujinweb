"""ISO 286 tolerance engine — data-driven calculation."""
from __future__ import annotations

from .parser import parse_class, parse_fit as parse_tolerance_combination
from .deviation import resolve as resolve_dimension
from .capabilities import get_capabilities, get_presets, get_zones
from .fit_calc import calculate_fit_result

__all__ = [
    "parse_tolerance_class",
    "parse_fit_combination",
    "resolve_dimension",
    "calculate_fit_result",
    "get_capabilities",
    "get_presets",
    "get_zones",
]
