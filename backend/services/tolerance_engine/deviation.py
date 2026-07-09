"""Fundamental deviation resolver. Uses ISO 286 rules and lookup tables."""
from __future__ import annotations

import json
from pathlib import Path

from .parser import TolError

_DATA_DIR = Path(__file__).parent / "data"
_deviations = None
_rules = None


def _load_deviations():
    global _deviations, _rules
    if _deviations is None:
        with open(_DATA_DIR / "fundamental_deviations.json", encoding="utf-8") as f:
            _deviations = json.load(f)
    if _rules is None:
        with open(_DATA_DIR / "public_rules.json", encoding="utf-8") as f:
            _rules = json.load(f)


def resolve(
    basic_mm: float,
    size_range_label: str,
    kind: str,
    zone: str,
    it_um: float,
    grade: int | None = None,
) -> dict:
    """Return lower/upper deviations and their symbols.

    Returns: {"lower_um": int, "upper_um": int, "lower_sym": str, "upper_sym": str}
    """
    _load_deviations()
    it = int(it_um) if it_um >= 1 else it_um

    # Find the rule for this zone
    rule = next((r for r in _rules["rules"] if r["kind"] == kind and r["zone"] == zone), None)
    if rule is None:
        # Try lowercase shaft variant
        alt_zone = zone.upper() if kind == "hole" else zone.lower()
        rule = next((r for r in _rules["rules"] if r["kind"] == kind and r["zone"] == alt_zone), None)
        if rule is None:
            raise TolError("unsupported_tolerance_zone",
                f"Unsupported {kind} zone '{zone}'",
                {"kind": kind, "zone": zone})

    lo_sym = rule["lower"]
    up_sym = rule["upper"]
    anchor = rule.get("anchor")

    if rule["method"] == "lower_zero":
        # H: EI = 0, ES = +IT
        return {"lower_um": 0, "upper_um": it, "lower_sym": lo_sym, "upper_sym": up_sym}
    elif rule["method"] == "upper_zero":
        # h: es = 0, ei = -IT
        return {"lower_um": -it, "upper_um": 0, "lower_sym": lo_sym, "upper_sym": up_sym}
    elif rule["method"] == "centered_on_zero":
        # JS/js: +/- IT/2, rounded per ISO convention
        half = it / 2
        lo = -round(half) if it >= 2 else round(-half, 1)
        up = round(half) if it >= 2 else round(half, 1)
        if isinstance(lo, float) and lo == int(lo): lo = int(lo)
        if isinstance(up, float) and up == int(up): up = int(up)
        return {"lower_um": lo, "upper_um": up, "lower_sym": lo_sym, "upper_sym": up_sym}
    elif rule["method"] == "table":
        return _table_lookup(kind, zone, size_range_label, it, lo_sym, up_sym, anchor)
    elif rule["method"] == "table_by_grade":
        return _table_by_grade_lookup(kind, zone, grade, size_range_label, it, lo_sym, up_sym, anchor)

    raise TolError("unsupported_tolerance_rule",
        f"Unsupported deviation rule method '{rule['method']}'",
        {"kind": kind, "zone": zone, "method": rule["method"]})


def _table_by_grade_lookup(
    kind: str,
    zone: str,
    grade: int | None,
    size_range: str,
    it: float,
    lo_sym: str,
    up_sym: str,
    anchor: str | None,
) -> dict:
    table_group = _deviations.get(kind, {}).get(zone)
    if table_group is None:
        raise TolError("unsupported_tolerance_zone",
            f"Deviation table not found for {kind} zone '{zone}'",
            {"kind": kind, "zone": zone})

    grade_tables = table_group.get("grades", {}) if isinstance(table_group, dict) else {}
    grade_key = str(grade)
    table = grade_tables.get(grade_key)
    if table is None:
        raise TolError("unsupported_tolerance_grade",
            f"No deviation data for {kind}{zone} grade IT{grade}",
            {"kind": kind, "zone": zone, "grade": grade})

    fd = table.get(size_range)
    if fd is None:
        raise TolError("unsupported_tolerance_zone",
            f"No deviation data for {kind}{zone}{grade} in size range {size_range}",
            {"kind": kind, "zone": zone, "grade": grade, "size_range": size_range})

    return _apply_table_deviation(kind, zone, fd, it, lo_sym, up_sym, anchor)


def _table_lookup(
    kind: str,
    zone: str,
    size_range: str,
    it: float,
    lo_sym: str,
    up_sym: str,
    anchor: str | None,
) -> dict:
    table = _deviations.get(kind, {}).get(zone)
    if table is None:
        raise TolError("unsupported_tolerance_zone",
            f"Deviation table not found for {kind} zone '{zone}'",
            {"kind": kind, "zone": zone})

    fd = table.get(size_range)
    if fd is None:
        raise TolError("unsupported_tolerance_zone",
            f"No deviation data for {kind} {zone} in size range {size_range}",
            {"kind": kind, "zone": zone, "size_range": size_range})

    return _apply_table_deviation(kind, zone, fd, it, lo_sym, up_sym, anchor)


def _apply_table_deviation(
    kind: str,
    zone: str,
    fd: float,
    it: float,
    lo_sym: str,
    up_sym: str,
    anchor: str | None,
) -> dict:
    it_int = int(it) if isinstance(it, float) and it == int(it) else int(it)

    if anchor == "lower":
        lo = fd
        up = lo + it_int
    elif anchor == "upper":
        up = fd
        lo = up - it_int
    else:
        raise TolError("invalid_tolerance_rule",
            f"Deviation rule for {kind} zone '{zone}' must define anchor lower or upper",
            {"kind": kind, "zone": zone, "anchor": anchor})

    return {"lower_um": lo, "upper_um": up, "lower_sym": lo_sym, "upper_sym": up_sym}
