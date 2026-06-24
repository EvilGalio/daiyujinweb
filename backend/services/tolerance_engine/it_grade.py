"""IT Grade tolerance width calculator. ISO 286 formula-based."""

from __future__ import annotations

# Size ranges: (lower, upper, D_geometric_mean)
_SIZE_RANGES = [
    (1, 3, 1.732), (3, 6, 4.243), (6, 10, 7.746), (10, 18, 13.416),
    (18, 30, 23.238), (30, 50, 38.73), (50, 80, 63.25), (80, 120, 97.98),
    (120, 180, 146.97), (180, 250, 212.13), (250, 315, 280.6),
    (315, 400, 355.0), (400, 500, 447.21),
]

# IT grade factors (K values) for IT5-IT18
_IT_FACTORS = {
    5: 7, 6: 10, 7: 16, 8: 25, 9: 40, 10: 64,
    11: 100, 12: 160, 13: 250, 14: 400, 15: 640,
    16: 1000, 17: 1600, 18: 2500,
}

# Special fine grades IT01-IT4 (simplified formula per ISO)
# IT01: 0.3 + 0.008*D, IT0: 0.5 + 0.012*D, IT1: 0.8 + 0.020*D
# IT2: (IT1)^(1/4) * (IT5)^(3/4) ≈ simplified
# IT3: (IT1)^(1/4) * (IT5)^(3/4) geometric
# IT4: (IT1)^(2/4) * (IT5)^(2/4) geometric
# For practical use, we approximate fine grades

def _find_range(basic_mm: float) -> tuple:
    for sr in _SIZE_RANGES:
        if sr[0] < basic_mm <= sr[1]:
            return sr
    raise ValueError(f"Basic size {basic_mm} mm out of supported range (1-500)")


def _fundamental_tolerance_unit(D_mm: float) -> float:
    """i = 0.45 * D^(1/3) + 0.001 * D  (for D up to 500mm)"""
    return 0.45 * (D_mm ** (1 / 3)) + 0.001 * D_mm


def it_width(basic_mm: float, grade: int) -> dict:
    """Return tolerance width in microns and size range info."""
    sr = _find_range(basic_mm)
    D = sr[2]  # geometric mean
    i = _fundamental_tolerance_unit(D)

    if 5 <= grade <= 18:
        K = _IT_FACTORS[grade]
        width_raw = K * i
    elif grade == 4:
        # IT4 ≈ (IT1)^(1/2) * (IT5)^(1/2) — geometric midpoint
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
