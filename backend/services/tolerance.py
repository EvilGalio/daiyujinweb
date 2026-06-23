from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any

from database import SessionLocal
from models import Inquiry


SIZE_RANGES: tuple[tuple[float, float], ...] = (
    (1, 3),
    (3, 6),
    (6, 10),
    (10, 18),
    (18, 30),
    (30, 50),
    (50, 80),
    (80, 120),
    (120, 180),
    (180, 250),
    (250, 315),
    (315, 400),
    (400, 500),
    (500, 630),
    (630, 800),
    (800, 1000),
    (1000, 1250),
    (1250, 1600),
    (1600, 2000),
    (2000, 2500),
    (2500, 3150),
)

IT_FACTORS: dict[int, float] = {
    5: 7,
    6: 10,
    7: 16,
    8: 25,
    9: 40,
    10: 64,
    11: 100,
    12: 160,
    13: 250,
    14: 400,
    15: 640,
    16: 1000,
    17: 1600,
    18: 2500,
}

PRESETS = ("H6/k5", "H7/g6", "H7/h6", "H7/p6", "H8/f7")
HOLE_ZONES = ("H", "JS")
SHAFT_ZONES = ("f", "g", "h", "k", "p")
TOLERANCE_RE = re.compile(r"^([A-Za-z]{1,2})(\d{1,2})$")


SHAFT_K_EI_BY_RANGE: dict[tuple[float, float], int] = {
    (1, 3): 0,
    (3, 6): 1,
    (6, 10): 1,
    (10, 18): 1,
    (18, 30): 2,
    (30, 50): 2,
    (50, 80): 2,
    (80, 120): 3,
    (120, 180): 3,
    (180, 250): 4,
    (250, 315): 4,
    (315, 400): 4,
    (400, 500): 5,
}

SHAFT_P_EI_BY_RANGE: dict[tuple[float, float], int] = {
    (1, 3): 6,
    (3, 6): 12,
    (6, 10): 15,
    (10, 18): 18,
    (18, 30): 22,
    (30, 50): 26,
    (50, 80): 32,
    (80, 120): 37,
    (120, 180): 43,
    (180, 250): 50,
    (250, 315): 56,
    (315, 400): 62,
    (400, 500): 68,
}


@dataclass(frozen=True)
class ToleranceSpec:
    zone: str
    grade: int

    @property
    def code(self) -> str:
        return f"{self.zone}{self.grade}"


def get_tolerance_zones() -> dict[str, Any]:
    return {
        "hole_zones": list(HOLE_ZONES),
        "shaft_zones": list(SHAFT_ZONES),
        "grades": [f"IT{grade}" for grade in sorted(IT_FACTORS)],
        "size_range_mm": {"min": 1, "max": 3150},
    }


def get_tolerance_presets() -> dict[str, Any]:
    return {"presets": list(PRESETS)}


def calculate_fit(
    basic_size_mm: float,
    fit_combination: str | None = None,
    hole_tolerance: str | None = None,
    shaft_tolerance: str | None = None,
    *,
    client_ip: str | None = None,
    user_agent: str | None = None,
    log_inquiry: bool = True,
) -> dict[str, Any]:
    size = _validate_size(basic_size_mm)
    if fit_combination:
        hole_code, shaft_code = _parse_fit_combination(fit_combination)
    else:
        hole_code = str(hole_tolerance or "").strip()
        shaft_code = str(shaft_tolerance or "").strip()
        if not hole_code or not shaft_code:
            raise ValueError("Provide fit_combination or both hole_tolerance and shaft_tolerance")

    hole_spec = _parse_tolerance(hole_code, kind="hole")
    shaft_spec = _parse_tolerance(shaft_code, kind="shaft")
    size_range = _find_size_range(size)
    diameter = math.sqrt(size_range[0] * size_range[1])

    hole = _build_hole(size, hole_spec, size_range, diameter)
    shaft = _build_shaft(size, shaft_spec, size_range, diameter)
    fit = _build_fit(hole, shaft)
    result = {
        "basic_size_mm": _round_mm(size),
        "size_range": _format_size_range(size_range),
        "fit_combination": f"{hole_spec.code}/{shaft_spec.code}",
        "hole": hole,
        "shaft": shaft,
        "fit": fit,
    }

    if log_inquiry:
        _record_inquiry(result, client_ip=client_ip, user_agent=user_agent)
    return result


def _validate_size(value: float) -> float:
    try:
        size = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("basic_size_mm must be a number") from exc
    if not math.isfinite(size) or size < 1 or size > 3150:
        raise ValueError("basic_size_mm must be between 1 and 3150")
    return size


def _parse_fit_combination(value: str) -> tuple[str, str]:
    parts = [part.strip() for part in str(value or "").split("/")]
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError("fit_combination must look like H7/g6")
    return parts[0], parts[1]


def _parse_tolerance(value: str, *, kind: str) -> ToleranceSpec:
    match = TOLERANCE_RE.match(value.strip())
    if not match:
        raise ValueError(f"{kind}_tolerance must look like H7 or g6")

    zone, grade_text = match.groups()
    zone = zone.upper() if kind == "hole" else zone.lower()
    grade = int(grade_text)
    if grade not in IT_FACTORS:
        raise ValueError(f"Unsupported tolerance grade IT{grade}")
    if kind == "hole" and zone not in HOLE_ZONES:
        raise ValueError(f"Unsupported hole zone {zone}")
    if kind == "shaft" and zone not in SHAFT_ZONES:
        raise ValueError(f"Unsupported shaft zone {zone}")
    return ToleranceSpec(zone=zone, grade=grade)


def _find_size_range(size: float) -> tuple[float, float]:
    for lower, upper in SIZE_RANGES:
        if lower == 1 and lower <= size <= upper:
            return lower, upper
        if lower < size <= upper:
            return lower, upper
    raise ValueError("basic_size_mm is outside supported size ranges")


def _format_size_range(size_range: tuple[float, float]) -> str:
    lower, upper = size_range
    return f"{lower:g}-{upper:g}"


def _it_tolerance_um(grade: int, diameter_mm: float) -> int:
    standard_unit = 0.45 * (diameter_mm ** (1 / 3)) + 0.001 * diameter_mm
    return int(round(IT_FACTORS[grade] * standard_unit))


def _build_hole(
    basic_size_mm: float,
    spec: ToleranceSpec,
    size_range: tuple[float, float],
    diameter_mm: float,
) -> dict[str, Any]:
    it_um = _it_tolerance_um(spec.grade, diameter_mm)
    if spec.zone == "H":
        lower_um = 0
        upper_um = it_um
    elif spec.zone == "JS":
        lower_um = -int(round(it_um / 2))
        upper_um = it_um + lower_um
    else:
        raise ValueError(f"Unsupported hole zone {spec.zone}")
    return _dimension_payload("hole", basic_size_mm, spec, it_um, lower_um, upper_um, size_range)


def _build_shaft(
    basic_size_mm: float,
    spec: ToleranceSpec,
    size_range: tuple[float, float],
    diameter_mm: float,
) -> dict[str, Any]:
    it_um = _it_tolerance_um(spec.grade, diameter_mm)
    if spec.zone == "h":
        upper_um = 0
        lower_um = -it_um
    elif spec.zone == "g":
        upper_um = int(round(-2.5 * (diameter_mm**0.34)))
        lower_um = upper_um - it_um
    elif spec.zone == "f":
        upper_um = int(round(-5.5 * (diameter_mm**0.41)))
        lower_um = upper_um - it_um
    elif spec.zone == "k":
        lower_um = _lookup_or_extrapolate(SHAFT_K_EI_BY_RANGE, size_range, diameter_mm)
        upper_um = lower_um + it_um
    elif spec.zone == "p":
        lower_um = _lookup_or_extrapolate(SHAFT_P_EI_BY_RANGE, size_range, diameter_mm)
        upper_um = lower_um + it_um
    else:
        raise ValueError(f"Unsupported shaft zone {spec.zone}")
    return _dimension_payload("shaft", basic_size_mm, spec, it_um, lower_um, upper_um, size_range)


def _lookup_or_extrapolate(
    table: dict[tuple[float, float], int],
    size_range: tuple[float, float],
    diameter_mm: float,
) -> int:
    if size_range in table:
        return table[size_range]
    if table is SHAFT_K_EI_BY_RANGE:
        return max(1, int(round(0.6 * (diameter_mm ** (1 / 3)))))
    it7 = _it_tolerance_um(7, diameter_mm)
    return int(round(it7 + 0.6 * (diameter_mm ** (1 / 3))))


def _dimension_payload(
    kind: str,
    basic_size_mm: float,
    spec: ToleranceSpec,
    it_um: int,
    lower_um: int,
    upper_um: int,
    size_range: tuple[float, float],
) -> dict[str, Any]:
    return {
        "kind": kind,
        "tolerance": spec.code,
        "zone": spec.zone,
        "grade": f"IT{spec.grade}",
        "it_um": it_um,
        "lower_deviation_um": lower_um,
        "upper_deviation_um": upper_um,
        "min_size_mm": _round_mm(basic_size_mm + lower_um / 1000),
        "max_size_mm": _round_mm(basic_size_mm + upper_um / 1000),
        "size_range": _format_size_range(size_range),
    }


def _build_fit(hole: dict[str, Any], shaft: dict[str, Any]) -> dict[str, Any]:
    raw_max_clearance_um = int(round((hole["max_size_mm"] - shaft["min_size_mm"]) * 1000))
    raw_min_clearance_um = int(round((hole["min_size_mm"] - shaft["max_size_mm"]) * 1000))
    if raw_min_clearance_um >= 0:
        fit_type = "clearance"
        label = "Clearance fit"
    elif raw_max_clearance_um <= 0:
        fit_type = "interference"
        label = "Interference fit"
    else:
        fit_type = "transition"
        label = "Transition fit"
    return {
        "type": fit_type,
        "label": label,
        "max_clearance_um": max(0, raw_max_clearance_um),
        "min_clearance_um": raw_min_clearance_um,
        "max_interference_um": max(0, -raw_min_clearance_um),
        "clearance_window_um": {
            "maximum": raw_max_clearance_um,
            "minimum": raw_min_clearance_um,
        },
    }


def _round_mm(value: float) -> float:
    return round(value, 6)


def _record_inquiry(result: dict[str, Any], *, client_ip: str | None, user_agent: str | None) -> None:
    session = SessionLocal()
    try:
        inquiry = Inquiry(
            type="tolerance",
            input_params=json.dumps(
                {
                    "basic_size_mm": result["basic_size_mm"],
                    "fit_combination": result["fit_combination"],
                },
                ensure_ascii=False,
            ),
            result=json.dumps(result, ensure_ascii=False),
            client_ip=client_ip,
            user_agent=user_agent,
        )
        session.add(inquiry)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        SessionLocal.remove()
