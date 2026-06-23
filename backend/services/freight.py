from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select

from database import SessionLocal
from models import ExchangeRate, FreightRate, Inquiry


SUPPORTED_CURRENCIES = {"CNY", "USD", "EUR"}


def get_countries() -> list[str]:
    session = SessionLocal()
    try:
        rows = session.execute(select(FreightRate.country).distinct().order_by(FreightRate.country)).all()
        return [row[0] for row in rows]
    finally:
        session.close()


def get_freight_summary() -> dict[str, Any]:
    session = SessionLocal()
    try:
        carriers = [row[0] for row in session.execute(select(FreightRate.carrier).distinct().order_by(FreightRate.carrier)).all()]
        countries = session.execute(select(func.count(func.distinct(FreightRate.country)))).scalar_one()
        records = session.execute(select(func.count(FreightRate.id))).scalar_one()
        min_weight = session.execute(select(func.min(FreightRate.weight_min))).scalar_one()
        max_weight = session.execute(select(func.max(FreightRate.weight_min))).scalar_one()
        return {
            "record_count": records,
            "country_count": countries,
            "carriers": carriers,
            "min_weight_kg": min_weight,
            "max_weight_kg": max_weight,
        }
    finally:
        session.close()


def _usd_to(session, currency: str) -> float | None:
    if currency == "USD":
        return 1.0
    rate = (
        session.execute(
            select(ExchangeRate.rate).where(
                ExchangeRate.from_currency == "USD",
                ExchangeRate.to_currency == currency,
            )
        )
        .scalars()
        .first()
    )
    return float(rate) if rate is not None else None


def _convert_currency(session, amount: float, from_currency: str, to_currency: str) -> tuple[float, float]:
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()
    if from_currency == to_currency:
        return amount, 1.0

    from_usd_rate = _usd_to(session, from_currency)
    to_usd_rate = _usd_to(session, to_currency)
    if from_usd_rate is None or to_usd_rate is None:
        raise ValueError(f"Missing exchange rate for {from_currency}->{to_currency}")

    usd_amount = amount / from_usd_rate
    converted = usd_amount * to_usd_rate
    return converted, to_usd_rate / from_usd_rate


def calculate_freight(
    country: str,
    weight_kg: float,
    carriers: list[str],
    currency: str,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    country = country.strip()
    currency = currency.upper()
    carriers = [carrier.strip() for carrier in carriers if carrier.strip()]

    if not country:
        raise ValueError("Destination country is required")
    if weight_kg <= 0:
        raise ValueError("Weight must be greater than 0")
    if not carriers:
        raise ValueError("Select at least one carrier")
    if currency not in SUPPORTED_CURRENCIES:
        raise ValueError(f"Unsupported currency: {currency}")

    session = SessionLocal()
    try:
        country_exists = (
            session.execute(select(FreightRate.id).where(FreightRate.country == country).limit(1))
            .scalars()
            .first()
        )
        if country_exists is None:
            raise ValueError(f"Unsupported destination country: {country}")

        results: list[dict[str, Any]] = []
        missing_carriers: list[str] = []
        for carrier in carriers:
            rate = (
                session.execute(
                    select(FreightRate)
                    .where(FreightRate.country == country)
                    .where(FreightRate.carrier == carrier)
                    .where(FreightRate.weight_min >= weight_kg)
                    .order_by(FreightRate.weight_min.asc())
                    .limit(1)
                )
                .scalars()
                .first()
            )
            if rate is None:
                missing_carriers.append(carrier)
                continue

            converted_amount, exchange_rate = _convert_currency(
                session,
                rate.base_price,
                rate.currency,
                currency,
            )
            results.append(
                {
                    "carrier": rate.carrier,
                    "country": rate.country,
                    "requested_weight_kg": weight_kg,
                    "billable_weight_kg": rate.weight_min,
                    "freight_amount": round(rate.base_price, 2),
                    "original_currency": rate.currency,
                    "converted_amount": round(converted_amount, 2),
                    "display_currency": currency,
                    "exchange_rate": round(exchange_rate, 6),
                    "zone": rate.zone,
                    "source": {
                        "sheet": rate.source_sheet,
                        "row": rate.source_row,
                    },
                }
            )

        payload = {
            "country": country,
            "weight_kg": weight_kg,
            "currency": currency,
            "results": results,
            "missing_carriers": missing_carriers,
        }

        session.add(
            Inquiry(
                type="freight",
                input_params=json.dumps(
                    {
                        "country": country,
                        "weight_kg": weight_kg,
                        "carriers": carriers,
                        "currency": currency,
                    },
                    ensure_ascii=False,
                ),
                result=json.dumps(payload, ensure_ascii=False),
                client_ip=client_ip,
                user_agent=user_agent,
            )
        )
        session.commit()
        return payload
    finally:
        session.close()
