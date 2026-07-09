"""IT Grade tolerance width calculator. Uses table data first."""

from __future__ import annotations

import json
import os
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"
_WIDTH_TABLE = None

# Size ranges: (lower, upper, D_geometric_mean)
_SIZE_RANGES = [
    (1, 3, 1.732), (3, 6, 4.243), (6, 10, 7.746), (10, 18, 13.416),
    (18, 30, 23.238), (30, 50, 38.73), (50, 80, 63.25), (80, 120, 97.98),
    (120, 180, 146.97), (180, 250, 212.13), (250, 315, 280.6),
    (315, 400, 355.0), (400, 500, 447.21), (500, 630, 561.249),
    (630, 800, 709.93), (800, 1000, 894.427), (1000, 1250, 1118.034),
    (1250, 1600, 1414.214), (1600, 2000, 1788.854), (2000, 2500, 2236.068),
    (2500, 3150, 2806.243),
]

# IT grade factors (K values) for IT5-IT18
_IT_FACTORS = {
    5: 7, 6: 10, 7: 16, 8: 25, 9: 40, 10: 64,
    11: 100, 12: 160, 13: 250, 14: 400, 15: 640,
    16: 1000, 17: 1600, 18: 2500,
}

# Special fine grades IT01-IT4 (simplified formula per ISO)
# IT01: 0.3 + 0.008*D, IT0: 0.5 + 0.012*D, IT1: 0.8 + 0.020*D
# IT2: (IT1)^(1/4) * (IT5)^(3/4), simplified
# IT3: (IT1)^(1/4) * (IT5)^(3/4) geometric
# IT4: (IT1)^(2/4) * (IT5)^(2/4) geometric
# For practical use, we approximate fine grades

def _find_range(basic_mm: float) -> tuple:
    for sr in _SIZE_RANGES:
        if sr[0] < basic_mm <= sr[1]:
            return sr
    raise ValueError(f"Basic size {basic_mm} mm out of supported range (1-3150)")


def _load_width_table() -> dict:
    global _WIDTH_TABLE
    if _WIDTH_TABLE is None:
        with open(_DATA_DIR / "standard_tolerance_widths.json", encoding="utf-8") as f:
            _WIDTH_TABLE = json.load(f)
    return _WIDTH_TABLE


def _grade_key(grade: int) -> str:
    return "IT01" if grade == -1 else f"IT{grade}"


def _fundamental_tolerance_unit(D_mm: float) -> float:
    """Return the fundamental tolerance unit used by this reference engine."""
    return 0.45 * (D_mm ** (1 / 3)) + 0.001 * D_mm


def _formula_it_width(basic_mm: float, grade: int) -> dict:
    sr = _find_range(basic_mm)
    D = sr[2]  # geometric mean
    i = _fundamental_tolerance_unit(D)

    if 5 <= grade <= 18:
        K = _IT_FACTORS[grade]
        width_raw = K * i
    elif grade == 4:
        # IT4 approximates the geometric midpoint between IT1 and IT5.
        it1_raw = (0.8 + 0.020 * D)
        it5_raw = 7 * i
        width_raw = (it1_raw ** 0.5) * (it5_raw ** 0.5)
    elif grade == 3:
        it1_raw = (0.8 + 0.020 * D)
        it5_raw = 7 * i
        width_raw = (it1_raw ** 0.25) * (it5_raw ** 0.75)
    elif grade == 2:
        it1_raw = (0.8 + 0.020 * D)
        it5_raw = 7 * i
        width_raw = (it1_raw ** 0.125) * (it5_raw ** 0.875)
    elif grade == 1:
        width_raw = 0.8 + 0.020 * D
    elif grade == 0:
        width_raw = 0.5 + 0.012 * D
    elif grade == -1:  # IT01
        width_raw = 0.3 + 0.008 * D
    else:
        raise ValueError(f"Unsupported IT grade: IT{grade}")

    # Round to integer per ISO convention
    width = round(width_raw) if width_raw >= 1 else round(width_raw, 1)
    if width_raw > 1:
        width = round(width_raw)
    else:
        width = round(width_raw, 1)

    return {
        "tolerance_width_um": int(width) if width >= 1 else width,
        "size_range": f"{sr[0]}-{sr[1]}",
        "size_range_D": round(D, 3),
        "source": "iso286_formula",
    }


def it_width(basic_mm: float, grade: int) -> dict:
    """Return tolerance width in microns and size range info."""
    sr = _find_range(basic_mm)
    size_label = f"{sr[0]}-{sr[1]}"
    grade_key = _grade_key(grade)
    table = _load_width_table()

    for row in table.get("ranges", []):
        if row.get("label") != size_label:
            continue
        if grade_key in row:
            return {
                "tolerance_width_um": row[grade_key],
                "size_range": size_label,
                "size_range_D": row.get("size_range_D", round(sr[2], 3)),
                "source": "iso286_table",
            }
        break

    if os.environ.get("TOLERANCE_ALLOW_FORMULA_FALLBACK", "").lower() in {"1", "true", "yes"}:
        return _formula_it_width(basic_mm, grade)

    raise ValueError(f"No table value for {grade_key} in size range {size_label}")
