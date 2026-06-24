"""Parser: parse tolerance class strings like H7, g6, JS7."""
from __future__ import annotations

import re

_TOKEN = re.compile(r"^([A-Za-z]{1,2})(\d{1,2})$")


class TolError(ValueError):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def parse_class(raw: str) -> dict:
    """Parse a single tolerance class like 'H7' or 'g6'.

    Returns: {"kind": "hole"|"shaft", "zone": str, "grade": int, "normalized": str}
    """
    s = raw.strip()
    m = _TOKEN.match(s)
    if not m:
        raise TolError("invalid_tolerance_format", f"Invalid tolerance format: {s!r}")
    zone = m.group(1)
    grade = int(m.group(2))
    kind = "hole" if zone[0].isupper() else "shaft"
    return {"kind": kind, "zone": zone, "grade": grade, "normalized": s}


def parse_fit(raw: str) -> dict:
    """Parse a fit combination like 'H7/g6'.

    Returns: {"hole": ..., "shaft": ..., "fit_combination": str}
    """
    parts = raw.strip().split("/")
    if len(parts) != 2:
        raise TolError("invalid_fit_combination", f"Expected format like H7/g6, got: {raw!r}")
    hole = parse_class(parts[0])
    shaft = parse_class(parts[1])
    return {"hole": hole, "shaft": shaft, "fit_combination": raw.strip()}
