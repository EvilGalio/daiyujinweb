"""Freight billing rules: weight tier rounding and packaging weight.

Implements the logic documented in 广诚DHL运费 row 1 and
the packaging-weight formulas from the Excel sheet.
"""

from __future__ import annotations


def dhl_billing_weight(actual_weight_kg: float) -> float:
    """DHL billing weight before packaging adjustment.

    From 广诚DHL运费 row 1:
    - ≤5kg:  add 1.5kg buffer, then round up to nearest 0.5
    - 5-10:  add 2kg, round up
    - 10-20: add 3kg, round up
    - 20-30: cap at 20kg tier (heavy item → use 20kg pricing)
    - >30:   heavy cargo; use actual (packaging applied separately)
    """
    w = actual_weight_kg
    if w <= 5:
        billable = w + 1.5
    elif w <= 10:
        billable = w + 2.0
    elif w <= 20:
        billable = w + 3.0
    elif w <= 30:
        return 20.0  # Cap at 20kg tier
    else:
        return w  # Heavy: actual weight, packaging applied later
    return _round_up_to_half(billable)


def fedex_billing_weight(actual_weight_kg: float) -> float:
    """FedEx billing weight.

    FedEx matrix goes 0.5–20.5kg. For >20.5, heavy cargo applies.
    We round up to the nearest 0.5, similar logic.
    """
    w = actual_weight_kg
    if w <= 20.5:
        return _round_up_to_half(w)
    return w


def _round_up_to_half(x: float) -> float:
    """Round up to nearest 0.5."""
    return round(x * 2 + 0.01) / 2


# ═══════════════════════════════════════════════════
# Packaging weight (applied after billing weight for heavy cargo)
# ═══════════════════════════════════════════════════

def dhl_packaging_weight(weight_kg: float) -> float:
    """DHL packaging weight adjustment.

    From 广诚DHL运费 formulas:
    - weight ≤ 33:     no adjustment
    - 33 < w ≤ 70:     +7.5 kg
    - 70 < w ≤ 300:    +12.5 kg
    - w > 300:         × 1.0822
    """
    if weight_kg <= 33:
        return weight_kg
    if weight_kg <= 70:
        return weight_kg + 7.5
    if weight_kg <= 300:
        return weight_kg + 12.5
    return weight_kg * 1.0822


def fedex_packaging_weight(weight_kg: float) -> float:
    """FedEx packaging weight adjustment.

    From 广诚FedEx运费 formulas:
    - weight ≤ 21.9:   no adjustment
    - 21.9 < w ≤ 40:   +4 kg
    - 40 < w ≤ 70:     +7.5 kg
    - 70 < w ≤ 300:    +12.5 kg
    - w > 300:         × 1.0822
    """
    if weight_kg <= 21.9:
        return weight_kg
    if weight_kg <= 40:
        return weight_kg + 4.0
    if weight_kg <= 70:
        return weight_kg + 7.5
    if weight_kg <= 300:
        return weight_kg + 12.5
    return weight_kg * 1.0822


# ═══════════════════════════════════════════════════
# Heavy cargo tier matching
# ═══════════════════════════════════════════════════

DHL_HEAVY_THRESHOLD = 30.0
FEDEX_HEAVY_THRESHOLD = 20.5


def is_dhl_heavy(weight_kg: float) -> bool:
    return weight_kg > DHL_HEAVY_THRESHOLD


def is_fedex_heavy(weight_kg: float) -> bool:
    return weight_kg > FEDEX_HEAVY_THRESHOLD
