"""DHL-only freight API.  Public responses return only final amount."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from database import SessionLocal
from models import DhlZone
from services.dhl_engine import calculate_dhl

DEFAULT_CURRENCY = "USD"


def get_countries() -> list[dict[str, str]]:
    session = SessionLocal()
    try:
        rows = session.execute(
            select(DhlZone.country, DhlZone.country_cn)
            .distinct().order_by(DhlZone.country)
        ).all()
        return [{"en": r[0], "cn": r[1] or r[0]} for r in rows]
    finally:
        session.close()


def get_country_list() -> list[str]:
    return [c["en"] for c in get_countries()]


def get_freight_summary() -> dict[str, Any]:
    from models import DhlSmallRate, DhlHeavyRate, DhlConfig
    session = SessionLocal()
    try:
        countries = session.execute(select(func.count(func.distinct(DhlZone.country)))).scalar_one()
        small = session.execute(select(func.count(DhlSmallRate.id))).scalar_one()
        heavy = session.execute(select(func.count(DhlHeavyRate.id))).scalar_one()
        return {
            "carrier": "DHL",
            "country_count": countries,
            "small_rate_count": small,
            "heavy_rate_count": heavy,
            "default_currency": DEFAULT_CURRENCY,
        }
    finally:
        session.close()


def calculate_freight(
    country: str,
    weight_kg: float = 5.0,
    carriers: list[str] | None = None,
    currency: str = DEFAULT_CURRENCY,
    **kwargs,
) -> dict[str, Any]:
    """DHL-only freight estimate.  Only country, weight_kg, currency are used."""
    return calculate_dhl(
        country=country.strip(),
        weight_kg=float(weight_kg),
        currency=str(currency).upper() if currency else DEFAULT_CURRENCY,
    )
