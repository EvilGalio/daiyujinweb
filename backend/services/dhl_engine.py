"""DHL freight calculation engine.  Implements the logic from A重量运费重制版.xlsx."""

from __future__ import annotations

import hashlib
import random
from typing import Any

from sqlalchemy import select
from database import SessionLocal
from models import DhlSmallRate, DhlHeavyRate, DhlZone, DhlConfig
from services.exchange_rates import convert_rmb

DEFAULT_CURRENCY = "USD"


def _dynamic_factor(country: str, weight_kg: float) -> float:
    """Deterministic random perturbation, ±0.8%. Never shown to users."""
    seed = hashlib.sha256(f"{country}|{weight_kg}".encode()).digest()
    rng = random.Random(int.from_bytes(seed[:8], "big"))
    return round(0.992 + rng.random() * 0.016, 4)


def _packaging_small(weight: float) -> float:
    """34kg以下加包装重量规则（Excel IF公式）。"""
    w = weight
    if w <= 5:
        return w + 1
    if w <= 10:
        return w + 2
    if w <= 16:
        return w + 3
    if w <= 20:
        return 20
    if w <= 26:
        return w - 7
    if w <= 33:
        return 20
    return w  # not used for small path


def _packaging_heavy(weight: float) -> float:
    """34kg以上计费重量规则。"""
    w = weight
    if w <= 33:
        return w  # shouldn't happen in heavy path
    if w <= 70:
        return w + 7.5
    if w <= 300:
        return w + 12.5
    return w * 1.0822


def _heavy_tier(charge_weight: float) -> str:
    if charge_weight <= 70:
        return "30.1-70"
    if charge_weight <= 300:
        return "70.1-300"
    return "300.1-999"


def _find_small_rate(session, country: str, charge_weight: float) -> float | None:
    """Find the next weight tier >= charge_weight, return base_price_cny."""
    from sqlalchemy import select as sel
    rate = session.execute(
        sel(DhlSmallRate.base_price_cny).where(
            DhlSmallRate.country == country,
            DhlSmallRate.charge_weight >= charge_weight,
        ).order_by(DhlSmallRate.charge_weight.asc()).limit(1)
    ).scalars().first()
    return float(rate) if rate is not None else None


def _find_heavy_rate(session, tier: str, zone_text: str) -> float | None:
    from sqlalchemy import select as sel
    rate = session.execute(
        sel(DhlHeavyRate.base_unit_price_cny).where(
            DhlHeavyRate.tier == tier,
            DhlHeavyRate.zone_text == zone_text,
        ).limit(1)
    ).scalars().first()
    return float(rate) if rate is not None else None


def calculate_dhl(country: str, weight_kg: float, currency: str = DEFAULT_CURRENCY) -> dict[str, Any]:
    currency = currency.upper()
    if currency not in ("CNY", "USD", "EUR"):
        currency = DEFAULT_CURRENCY

    session = SessionLocal()
    try:
        # 1. Find zone
        zone_row = session.execute(
            select(DhlZone.zone_code, DhlZone.country).where(
                (DhlZone.country == country) | (DhlZone.country_cn == country)
            ).limit(1)
        ).first()
        if zone_row is None:
            raise ValueError("Destination is not supported yet.")
        zone_code, resolved_country = zone_row

        # 2. Get config
        configs = {c.key: c for c in session.query(DhlConfig).all()}

        small_mult = float(configs.get("small_multiplier", DhlConfig(key="x", value="1.8")).value)
        heavy_mult = float(configs.get("heavy_multiplier", DhlConfig(key="x", value="1.7")).value)
        # 3. Calculate
        if weight_kg <= 33:
            charge_weight = _packaging_small(weight_kg)
            base_price = _find_small_rate(session, resolved_country, charge_weight)
            if base_price is None:
                raise ValueError("No DHL rate found for this shipment.")
            rmb_total = base_price * small_mult
        else:
            charge_weight = _packaging_heavy(weight_kg)
            tier = _heavy_tier(charge_weight)
            base_unit = _find_heavy_rate(session, tier, f"{zone_code}区")
            if base_unit is None:
                raise ValueError("No DHL rate found for this shipment.")
            rmb_unit = base_unit * heavy_mult
            rmb_total = rmb_unit * charge_weight

        # 4. Currency conversion
        amount = round(float(convert_rmb(rmb_total, currency)), 2)

        # Apply dynamic perturbation (always hidden from users)
        factor = _dynamic_factor(resolved_country, weight_kg)
        amount = round(amount * factor, 2)

        return {
            "country": resolved_country,
            "carrier": "DHL",
            "weight_kg": weight_kg,
            "currency": currency,
            "amount": amount,
        }
    finally:
        session.close()
