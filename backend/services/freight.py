"""Freight estimate calculation engine v2.

Supports four pricing modes:
  - small_matrix: zone-expanded weight-tier matrix
  - document: DHL document rates (2KG内文件)
  - heavy_per_kg: per-kg unit price x adjusted weight
  - (volumetric: optional, when advanced dimensions are provided)

Default display currency: USD.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from database import SessionLocal
from models import (ExchangeRate, FreightRate, FreightRateCard, FreightSurchargeConfig,
                    FreightZone)
from services import freight_rules, freight_surcharges

SUPPORTED_CURRENCIES = {"CNY", "USD", "EUR"}
DEFAULT_DISPLAY = "USD"


# ── Country lookup ───────────────────────────────

def get_countries() -> list[dict[str, str]]:
    session = SessionLocal()
    try:
        rows = session.execute(
            select(FreightZone.country, FreightZone.country_cn)
            .distinct()
            .order_by(FreightZone.country)
        ).all()
        return [{"en": row[0], "cn": row[1] or row[0]} for row in rows]
    finally:
        session.close()


def get_country_list() -> list[str]:
    return [c["en"] for c in get_countries()]


# ── Summary ──────────────────────────────────────

def get_freight_summary() -> dict[str, Any]:
    session = SessionLocal()
    try:
        carriers = [
            row[0] for row in session.execute(
                select(FreightRateCard.carrier).distinct().order_by(FreightRateCard.carrier)
            ).all()
        ]
        zones = session.execute(
            select(func.count(func.distinct(FreightZone.country)))
        ).scalar_one()
        cards = session.execute(select(func.count(FreightRateCard.id))).scalar_one()
        modes = [
            row[0] for row in session.execute(
                select(FreightRateCard.pricing_mode).distinct().order_by(FreightRateCard.pricing_mode)
            ).all()
        ]
        return {
            "rate_card_count": cards,
            "country_count": zones,
            "carriers": carriers,
            "supported_pricing_modes": modes,
            "default_display_currency": DEFAULT_DISPLAY,
        }
    finally:
        session.close()


# ── Exchange ─────────────────────────────────────

def _usd_to(session, currency: str) -> float | None:
    if currency == "USD":
        return 1.0
    rate = session.execute(
        select(ExchangeRate.rate).where(
            ExchangeRate.from_currency == "USD",
            ExchangeRate.to_currency == currency,
        )
    ).scalars().first()
    return float(rate) if rate is not None else None


def _convert_currency(session, amount: float, from_currency: str, to_currency: str) -> tuple[float, float]:
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()
    if from_currency == to_currency:
        return amount, 1.0
    from_rate = _usd_to(session, from_currency)
    to_rate = _usd_to(session, to_currency)
    if from_rate is None or to_rate is None:
        raise ValueError(f"Missing exchange rate for {from_currency} -> {to_currency}")
    usd_amount = amount / from_rate
    return usd_amount * to_rate, to_rate / from_rate


# ── Zone query helper ────────────────────────────

def _zone_variants(zone_code: str) -> list[str]:
    """Return zone_code plus any known variants (e.g., '7', '7区')."""
    codes = [zone_code]
    if zone_code.endswith("区"):
        codes.append(zone_code.rstrip("区"))
    else:
        codes.append(zone_code + "区")
    return list(set(codes))


# ── Main calculate ───────────────────────────────

def calculate_freight(
    country: str,
    weight_kg: float = 5.0,
    carriers: list[str] | None = None,
    currency: str = DEFAULT_DISPLAY,
    actual_weight_kg: float | None = None,
    cargo_type: str = "package",
    advanced: dict | None = None,
) -> dict[str, Any]:
    """Calculate freight estimate for a destination.

    Backwards-compatible: 'weight_kg' is used if 'actual_weight_kg' not provided.
    'advanced' may contain boxes and dimensions for volumetric weight.
    """
    country = country.strip()
    currency = currency.upper()

    if carriers is None:
        carriers = ["DHL", "FedEx"]
    carriers = [c.strip() for c in carriers if c.strip()]

    if actual_weight_kg is not None:
        actual_weight_kg = float(actual_weight_kg)
    else:
        actual_weight_kg = float(weight_kg)

    if actual_weight_kg <= 0:
        raise ValueError("Weight must be greater than 0")
    if not carriers:
        raise ValueError("Select at least one carrier")
    if currency not in SUPPORTED_CURRENCIES:
        raise ValueError(f"Unsupported currency: {currency}")

    # ── Volumetric weight (advanced, optional) ──
    volumetric_weight_kg: float | None = None
    advanced_enabled = False
    boxes = 1
    if advanced and advanced.get("dimensions"):
        dims = advanced["dimensions"]
        length = dims.get("length_cm")
        width = dims.get("width_cm")
        height = dims.get("height_cm")
        if length and width and height:
            divisor = 5000
            boxes = int(advanced.get("boxes", 1))
            volumetric_weight_kg = round((length * width * height * boxes) / divisor, 2)
            advanced_enabled = True
        elif length or width or height:
            raise ValueError("Dimensions incomplete: provide length, width, and height together.")

    billable_base = max(actual_weight_kg, volumetric_weight_kg or 0)

    session = SessionLocal()
    try:
        # ── Resolve country + zone(s) ──
        zone_rows = session.execute(
            select(FreightZone).where(
                (FreightZone.country == country) | (FreightZone.country_cn == country)
            )
        ).scalars().all()

        if not zone_rows:
            raise ValueError(f"Unsupported destination country: {country}")
        resolved_country = zone_rows[0].country
        zone_map = {}
        for z in zone_rows:
            if z.carrier not in zone_map:
                zone_map[z.carrier] = z

        # ── Load surcharge configs ──
        surcharge_rows = session.execute(
            select(FreightSurchargeConfig).where(FreightSurchargeConfig.enabled == True)
        ).scalars().all()
        surcharge_by_carrier: dict[str, list[FreightSurchargeConfig]] = {}
        for sc in surcharge_rows:
            surcharge_by_carrier.setdefault(sc.carrier, []).append(sc)
        surcharge_all = surcharge_by_carrier.get("all", [])

        results: list[dict[str, Any]] = []
        missing: list[str] = []

        for carrier in carriers:
            result = _calc_one(
                session, carrier, resolved_country, zone_map, billable_base,
                actual_weight_kg, volumetric_weight_kg, advanced_enabled, boxes,
                cargo_type, currency, surcharge_all + surcharge_by_carrier.get(carrier, [])
            )
            if result is None:
                missing.append(carrier)
            else:
                results.append(result)

        return {
            "country": country,
            "currency": currency,
            "inputs": {
                "actual_weight_kg": actual_weight_kg,
                "volumetric_weight_kg": volumetric_weight_kg,
                "advanced_enabled": advanced_enabled,
                "boxes": boxes,
                "cargo_type": cargo_type,
            },
            "results": results,
            "missing_carriers": missing,
        }
    finally:
        session.close()


def _calc_one(
    session,
    carrier: str,
    country: str,
    zone_map: dict,
    billable_base: float,
    actual_weight_kg: float,
    volumetric_weight_kg: float | None,
    advanced_enabled: bool,
    boxes: int,
    cargo_type: str,
    currency: str,
    surcharges: list,
) -> dict[str, Any] | None:
    """Calculate freight for a single carrier."""

    zone_entry = zone_map.get(carrier)
    if zone_entry is None:
        return None
    zone_code = zone_entry.zone_code
    zone_codes = _zone_variants(zone_code)

    if cargo_type == "document" and carrier == "DHL" and billable_base <= 2:
        pricing_mode = "document"
    elif carrier == "DHL" and freight_rules.is_dhl_heavy(billable_base):
        pricing_mode = "heavy_per_kg"
    elif carrier == "FedEx" and freight_rules.is_fedex_heavy(billable_base):
        pricing_mode = "heavy_per_kg"
    else:
        pricing_mode = "small_matrix"

    explanation: list[str] = []
    packaging_adjusted: float | None = None
    charge_weight: float = billable_base
    unit_price: float | None = None
    base_freight: float = 0.0
    source_sheet: str = ""
    source_row: int | None = None

    # ── Small matrix path ──
    if pricing_mode == "small_matrix":
        rate = session.execute(
            select(FreightRateCard).where(
                FreightRateCard.carrier == carrier,
                FreightRateCard.pricing_mode == "small_matrix",
                FreightRateCard.zone_code.in_(zone_codes),
                FreightRateCard.weight_min >= billable_base,
            ).order_by(FreightRateCard.weight_min.asc()).limit(1)
        ).scalars().first()

        if rate is None:
            return None

        base_freight = rate.price
        charge_weight = rate.weight_min
        source_sheet = rate.source_sheet or ""
        source_row = rate.source_row
        if advanced_enabled:
            explanation.append(f"Advanced dimensions: {actual_weight_kg}kg actual, {volumetric_weight_kg}kg volumetric.")
        explanation.append(f"{carrier} small matrix: matched {charge_weight}kg tier (requested {billable_base}kg).")

    # ── Document path ──
    elif pricing_mode == "document":
        w_tier = freight_rules._round_up_to_half(billable_base)
        rate = session.execute(
            select(FreightRateCard).where(
                FreightRateCard.carrier == "DHL",
                FreightRateCard.pricing_mode == "document",
                FreightRateCard.zone_code.in_(zone_codes),
                FreightRateCard.weight_min >= w_tier,
            ).order_by(FreightRateCard.weight_min.asc()).limit(1)
        ).scalars().first()

        if rate is None:
            return None

        base_freight = rate.price
        charge_weight = rate.weight_min
        source_sheet = rate.source_sheet or ""
        source_row = rate.source_row
        explanation.append(f"DHL document rate: matched {charge_weight}kg tier.")

    # ── Heavy per-kg path ──
    else:
        if carrier == "DHL":
            packaging_adjusted = freight_rules.dhl_packaging_weight(billable_base)
        else:
            packaging_adjusted = freight_rules.fedex_packaging_weight(billable_base)

        charge_weight = packaging_adjusted

        rate = session.execute(
            select(FreightRateCard).where(
                FreightRateCard.carrier == carrier,
                FreightRateCard.pricing_mode == "heavy_per_kg",
                FreightRateCard.zone_code.in_(zone_codes),
                FreightRateCard.weight_min <= packaging_adjusted,
                ((FreightRateCard.weight_max == None) | (FreightRateCard.weight_max >= packaging_adjusted)),
            ).order_by(FreightRateCard.weight_min.asc()).limit(1)
        ).scalars().first()

        if rate is None:
            return None

        unit_price = rate.price
        base_freight = round(unit_price * packaging_adjusted, 2)
        source_sheet = rate.source_sheet or ""
        source_row = rate.source_row

        if packaging_adjusted != billable_base:
            diff = round(packaging_adjusted - billable_base, 1)
            explanation.append(f"{carrier} heavy cargo: packaging rule adds {diff}kg.")
        else:
            explanation.append(f"{carrier} heavy cargo rate applied.")
        explanation.append(f"Zone {zone_code}: tier {rate.weight_min}-{rate.weight_max}, unit price {unit_price}/kg.")
        explanation.append(f"Base freight = {unit_price} x {packaging_adjusted}kg = {base_freight} CNY.")

    # ── Surcharges ──
    surcharge_details = []
    for sc in surcharges:
        amt = freight_surcharges.calculate_surcharge(
            base_amount=base_freight,
            charge_weight_kg=charge_weight,
            surcharge_type=sc.surcharge_type,
            calculation_type=sc.calculation_type,
            rate=float(sc.rate),
            fixed_amount=float(sc.fixed_amount) if sc.fixed_amount else None,
        )
        surcharge_details.append({
            "type": sc.surcharge_type,
            "label": f"{sc.surcharge_type.replace('_', ' ').title()} surcharge",
            "amount": round(amt, 2),
            "currency": "CNY",
            "rate": float(sc.rate),
        })

    subtotal = base_freight + sum(s["amount"] for s in surcharge_details)
    converted_total, exchange_rate = _convert_currency(session, subtotal, "CNY", currency)
    explanation.append(f"Fuel and infrastructure surcharges applied ({len(surcharge_details)} total).")
    explanation.append(f"Total converted from CNY to {currency}.")

    return {
        "carrier": carrier,
        "pricing_mode": pricing_mode,
        "zone": zone_code,
        "actual_weight_kg": actual_weight_kg,
        "volumetric_weight_kg": volumetric_weight_kg,
        "billable_weight_kg": billable_base,
        "charge_weight_kg": round(charge_weight, 2),
        "packaging_adjusted_weight_kg": round(packaging_adjusted, 2) if packaging_adjusted else None,
        "unit_price": unit_price,
        "base_freight": round(base_freight, 2),
        "surcharges": surcharge_details,
        "subtotal": round(subtotal, 2),
        "original_currency": "CNY",
        "converted_total": round(converted_total, 2),
        "display_currency": currency,
        "exchange_rate": round(exchange_rate, 6),
        "explanation": explanation,
        "source": {
            "sheet": source_sheet,
            "row": source_row,
        },
    }
