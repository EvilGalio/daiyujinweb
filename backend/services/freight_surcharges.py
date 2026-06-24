"""Freight surcharge computations: fuel, infrastructure, and others."""

from __future__ import annotations


def calculate_surcharge(
    base_amount: float,
    charge_weight_kg: float,
    surcharge_type: str,
    calculation_type: str,
    rate: float,
    fixed_amount: float | None = None,
) -> float:
    """Compute a single surcharge amount.

    Args:
        base_amount: base freight amount in source currency
        charge_weight_kg: chargeable weight in kg
        surcharge_type: fuel / infrastructure / other
        calculation_type: percentage / fixed / per_kg
        rate: percentage (as decimal, e.g. 0.15 for 15%) or per-kg rate
        fixed_amount: fixed currency amount (for 'fixed' type)

    Returns:
        Surcharge amount in the same currency as base_amount.
    """
    if calculation_type == "percentage":
        return base_amount * rate
    elif calculation_type == "fixed":
        return fixed_amount or 0.0
    elif calculation_type == "per_kg":
        return charge_weight_kg * rate
    return 0.0
