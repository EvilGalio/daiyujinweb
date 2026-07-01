from __future__ import annotations

import json
import logging
import math
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from database import SessionLocal
from models import ExchangeRate


LOGGER = logging.getLogger(__name__)
FRANKFURTER_RATE_URL = "https://api.frankfurter.dev/v2/rate/{base}/{quote}"

DEFAULT_RATES: dict[tuple[str, str], Decimal] = {
    ("CNY", "USD"): Decimal("0.1388888889"),
    ("CNY", "EUR"): Decimal("0.1277777778"),
    ("USD", "CNY"): Decimal("7.20"),
    ("EUR", "CNY"): Decimal("7.8260869565"),
    ("USD", "EUR"): Decimal("0.92"),
    ("EUR", "USD"): Decimal("1.0869565217"),
}


def _normalize_currency(value: str) -> str:
    return str(value or "").strip().upper()


def _decimal_rate(value: Any) -> Decimal:
    rate = Decimal(str(value))
    if not math.isfinite(float(rate)) or rate <= 0:
        raise ValueError(f"Invalid exchange rate: {value!r}")
    return rate


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _fetch_rate(base: str, quote: str, timeout: float = 10.0) -> Decimal:
    url = FRANKFURTER_RATE_URL.format(base=base, quote=quote)
    req = urllib.request.Request(url, headers={"User-Agent": "daiyujin-tools/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if "rate" in payload:
        return _decimal_rate(payload["rate"])
    if isinstance(payload.get("rates"), dict) and quote in payload["rates"]:
        return _decimal_rate(payload["rates"][quote])
    raise ValueError(f"Unexpected exchange-rate response for {base}->{quote}")


def _upsert_rate(session, from_currency: str, to_currency: str, rate: Decimal) -> None:
    now = datetime.utcnow()
    row = (
        session.query(ExchangeRate)
        .filter_by(from_currency=from_currency, to_currency=to_currency)
        .one_or_none()
    )
    if row is None:
        session.add(
            ExchangeRate(
                from_currency=from_currency,
                to_currency=to_currency,
                rate=float(rate),
                created_at=now,
                updated_at=now,
            )
        )
    else:
        row.rate = float(rate)
        row.updated_at = now


def refresh_exchange_rates() -> dict[str, Any]:
    cny_usd = _fetch_rate("CNY", "USD")
    cny_eur = _fetch_rate("CNY", "EUR")

    rates = {
        ("CNY", "USD"): cny_usd,
        ("CNY", "EUR"): cny_eur,
        ("USD", "CNY"): Decimal("1") / cny_usd,
        ("EUR", "CNY"): Decimal("1") / cny_eur,
        ("USD", "EUR"): cny_eur / cny_usd,
        ("EUR", "USD"): cny_usd / cny_eur,
    }

    session = SessionLocal()
    try:
        before = {
            f"{row.from_currency}->{row.to_currency}": row.rate
            for row in session.query(ExchangeRate).all()
        }
        for (from_currency, to_currency), rate in rates.items():
            _upsert_rate(session, from_currency, to_currency, rate)
        session.commit()
        after = {f"{k[0]}->{k[1]}": float(v) for k, v in rates.items()}
        return {"success": True, "updated_at": datetime.utcnow().isoformat(), "before": before, "after": after}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        SessionLocal.remove()


def get_rate(from_currency: str, to_currency: str) -> Decimal:
    from_currency = _normalize_currency(from_currency)
    to_currency = _normalize_currency(to_currency)
    if not from_currency or not to_currency:
        raise ValueError("Currency code is required")
    if from_currency == to_currency:
        return Decimal("1")

    session = SessionLocal()
    try:
        row = (
            session.query(ExchangeRate)
            .filter_by(from_currency=from_currency, to_currency=to_currency)
            .one_or_none()
        )
        if row is not None:
            try:
                return _decimal_rate(row.rate)
            except ValueError:
                LOGGER.warning("Ignoring invalid stored exchange rate %s->%s", from_currency, to_currency)

        inverse = (
            session.query(ExchangeRate)
            .filter_by(from_currency=to_currency, to_currency=from_currency)
            .one_or_none()
        )
        if inverse is not None:
            try:
                return Decimal("1") / _decimal_rate(inverse.rate)
            except ValueError:
                LOGGER.warning("Ignoring invalid inverse exchange rate %s->%s", to_currency, from_currency)
    finally:
        session.close()
        SessionLocal.remove()

    fallback = DEFAULT_RATES.get((from_currency, to_currency))
    if fallback is not None:
        return fallback
    raise ValueError(f"Unsupported currency conversion: {from_currency}->{to_currency}")


def convert_rmb(amount_rmb: float | Decimal, target_currency: str) -> Decimal:
    currency = _normalize_currency(target_currency)
    amount = Decimal(str(amount_rmb))
    if currency == "CNY":
        return _quantize_money(amount)
    return _quantize_money(amount * get_rate("CNY", currency))


def ensure_recent_rates(max_age_hours: int = 30) -> dict[str, Any]:
    session = SessionLocal()
    try:
        rows = session.query(ExchangeRate).all()
        newest = max((row.updated_at for row in rows if row.updated_at), default=None)
    finally:
        session.close()
        SessionLocal.remove()

    if newest is not None and newest >= datetime.utcnow() - timedelta(hours=max_age_hours):
        return {"success": True, "refreshed": False, "updated_at": newest.isoformat()}

    try:
        result = refresh_exchange_rates()
        result["refreshed"] = True
        return result
    except Exception as exc:
        LOGGER.warning("Exchange-rate refresh failed; keeping stored rates: %s", exc)
        return {"success": False, "refreshed": False, "error": str(exc)}
