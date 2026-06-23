from __future__ import annotations

import hashlib
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from database import SessionLocal
from models import ExchangeRate, Inquiry, Material, QuantityTier, SizeCost, SurfaceTreatment, ToleranceGrade


BACKEND_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = BACKEND_ROOT / "uploads"
QUOTE_DISCLAIMER = (
    "This estimate is prepared by our assessment system as a preliminary reference. "
    "Final pricing is confirmed by our engineering team after design review. "
    "Taxes, duties, and shipping are not included. "
    "For a binding quotation, please submit a formal request \u2014 we typically respond within one business day."
)


def get_quote_options() -> dict[str, Any]:
    session = SessionLocal()
    try:
        materials = (
            session.query(Material)
            .filter_by(is_active=True)
            .order_by(Material.name)
            .all()
        )
        tolerance_grades = session.query(ToleranceGrade).order_by(ToleranceGrade.grade).all()
        treatments = (
            session.query(SurfaceTreatment)
            .filter_by(is_active=True)
            .order_by(SurfaceTreatment.name)
            .all()
        )
        currencies = sorted(
            {
                row.to_currency
                for row in session.query(ExchangeRate).filter_by(from_currency="USD").all()
            }
        )
        return {
            "materials": [
                {
                    "id": material.id,
                    "name": material.name,
                    "density_gcm3": material.density_gcm3,
                    "category": material.category,
                }
                for material in materials
            ],
            "tolerance_grades": [
                {"grade": grade.grade, "label": grade.label}
                for grade in tolerance_grades
            ],
            "surface_treatments": [
                {"id": treatment.id, "name": treatment.name}
                for treatment in treatments
            ],
            "currencies": currencies or ["USD"],
            "default_currency": "USD",
        }
    finally:
        session.close()
        SessionLocal.remove()


def recalculate_weight(volume_mm3: float, material_id: int) -> dict[str, Any]:
    session = SessionLocal()
    try:
        volume = _validate_volume(volume_mm3)
        material = _get_material(session, material_id)
        return {
            "material": _public_material(material),
            "volume_mm3": round(volume, 3),
            "weight_kg": _weight_kg(volume, material.density_gcm3),
        }
    finally:
        session.close()
        SessionLocal.remove()


def calculate_quote(payload: dict[str, Any], *, client_ip: str | None = None, user_agent: str | None = None) -> dict[str, Any]:
    session = SessionLocal()
    try:
        quantity = _validate_quantity(payload.get("quantity"))
        volume_mm3 = _validate_volume(payload.get("volume_mm3"))
        max_dim_mm = _parse_max_dim(payload.get("max_dim_mm"), payload.get("obb_dimensions_mm"))
        material = _get_material(session, payload.get("material_id"))
        tolerance = _get_tolerance_grade(session, payload.get("tolerance_grade"))
        treatments = _get_treatments(session, payload.get("surface_treatment_ids", []))
        tier = _get_quantity_tier(session, quantity)
        size_cost = _get_size_cost(session, max_dim_mm)
        currency = str(payload.get("currency") or "USD").upper()
        exchange_rate = _get_exchange_rate(session, currency)
        file_id = str(payload.get("file_id") or "").strip()
        stored_path = _find_uploaded_file(file_id) if file_id else None

        weight_kg = _weight_kg(volume_mm3, material.density_gcm3)
        material_total_usd = weight_kg * material.unit_price_usd_kg * quantity
        machining_total_usd = size_cost.base_cost_usd * quantity * tolerance.factor * tier.factor
        treatment_total_usd = sum(treatment.cost_usd for treatment in treatments) * quantity
        subtotal_usd = material_total_usd + machining_total_usd + treatment_total_usd
        base_total_usd = round(subtotal_usd, 2)

        seed = str(payload.get("file_id", "")) + str(payload.get("material_id", "")) + str(quantity)
        seed_hash = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
        rng = random.Random(seed_hash)
        dynamic_factor = round(0.985 + rng.random() * 0.03, 4)
        display_total_usd = round(base_total_usd * dynamic_factor, 2)
        total_amount = round(display_total_usd * exchange_rate, 2)

        result = {
            "quote_status": "estimated",
            "valid_until": (date.today() + timedelta(days=7)).isoformat(),
            "currency": currency,
            "exchange_rate_basis": "USD",
            "part": {
                "file_id": file_id or None,
                "name": str(payload.get("part_name") or payload.get("stp_filename") or "STEP part"),
                "stp_filename": str(payload.get("stp_filename") or ""),
                "stored_path": str(stored_path) if stored_path else None,
                "volume_mm3": round(volume_mm3, 3),
                "max_dim_mm": round(max_dim_mm, 3),
                "weight_kg": weight_kg,
            },
            "selections": {
                "material": _public_material(material),
                "tolerance_grade": {"grade": tolerance.grade, "label": tolerance.label},
                "surface_treatments": [{"id": treatment.id, "name": treatment.name} for treatment in treatments],
                "quantity": quantity,
                "quantity_tier": _tier_label(tier),
                "size_bucket": f"<= {size_cost.max_dim_mm:g} mm",
            },
            "breakdown": [
                _money_line("Material", material_total_usd * dynamic_factor, exchange_rate, currency),
                _money_line("Machining", machining_total_usd * dynamic_factor, exchange_rate, currency),
                _money_line("Surface treatment", treatment_total_usd * dynamic_factor, exchange_rate, currency),
            ],
            "total": {
                "amount": total_amount,
                "currency": currency,
                "amount_usd": display_total_usd,
                "display": _format_money(total_amount, currency),
            },
            "dynamic_factor": dynamic_factor,
            "base_total_usd": base_total_usd,
            "disclaimer": QUOTE_DISCLAIMER,
        }
        _record_quote_inquiry(session, payload, result, client_ip=client_ip, user_agent=user_agent)
        return result
    finally:
        session.close()
        SessionLocal.remove()


def request_formal_quote(payload: dict[str, Any], *, client_ip: str | None = None, user_agent: str | None = None) -> dict[str, Any]:
    session = SessionLocal()
    try:
        quote_result = payload.get("quote_result") or {}
        if not isinstance(quote_result, dict) or not quote_result:
            raise ValueError("quote_result is required")
        inquiry = Inquiry(
            type="quote_formal_request",
            stp_filename=str(quote_result.get("part", {}).get("stp_filename") or ""),
            stp_file_path=str(quote_result.get("part", {}).get("stored_path") or ""),
            input_params=json.dumps(payload, ensure_ascii=False),
            result=json.dumps(quote_result, ensure_ascii=False),
            client_ip=client_ip,
            user_agent=user_agent,
        )
        session.add(inquiry)
        session.commit()
        return {
            "inquiry_id": inquiry.id,
            "status": "received",
            "message": "Formal quote request received. Engineering review is required before binding quotation.",
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        SessionLocal.remove()


def _get_material(session, material_id: Any) -> Material:
    try:
        item_id = int(material_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("material_id is required") from exc
    material = session.get(Material, item_id)
    if material is None or not material.is_active:
        raise ValueError("Unknown material_id")
    return material


def _get_tolerance_grade(session, grade: Any) -> ToleranceGrade:
    value = str(grade or "").strip().upper()
    if not value:
        raise ValueError("tolerance_grade is required")
    row = session.query(ToleranceGrade).filter_by(grade=value).one_or_none()
    if row is None:
        raise ValueError("Unknown tolerance_grade")
    return row


def _get_treatments(session, values: Any) -> list[SurfaceTreatment]:
    if values is None:
        values = []
    if not isinstance(values, list):
        raise ValueError("surface_treatment_ids must be a list")
    ids = sorted({int(value) for value in values if str(value).strip()})
    if not ids:
        return []
    rows = (
        session.query(SurfaceTreatment)
        .filter(SurfaceTreatment.id.in_(ids), SurfaceTreatment.is_active.is_(True))
        .all()
    )
    if len(rows) != len(ids):
        raise ValueError("Unknown surface_treatment_ids")
    return rows


def _get_quantity_tier(session, quantity: int) -> QuantityTier:
    tier = (
        session.query(QuantityTier)
        .filter(QuantityTier.min_qty <= quantity)
        .filter((QuantityTier.max_qty.is_(None)) | (QuantityTier.max_qty >= quantity))
        .order_by(QuantityTier.min_qty.desc())
        .first()
    )
    if tier is None:
        raise ValueError("No quantity tier configured")
    return tier


def _get_size_cost(session, max_dim_mm: float) -> SizeCost:
    row = session.query(SizeCost).filter(SizeCost.max_dim_mm >= max_dim_mm).order_by(SizeCost.max_dim_mm).first()
    if row is None:
        raise ValueError("Part dimensions exceed configured size cost table")
    return row


def _get_exchange_rate(session, currency: str) -> float:
    row = session.query(ExchangeRate).filter_by(from_currency="USD", to_currency=currency).one_or_none()
    if row is None:
        raise ValueError(f"Unsupported currency {currency}")
    return row.rate


def _validate_quantity(value: Any) -> int:
    try:
        quantity = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("quantity must be an integer") from exc
    if quantity < 1 or quantity > 100000:
        raise ValueError("quantity must be between 1 and 100000")
    return quantity


def _validate_volume(value: Any) -> float:
    try:
        volume = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("volume_mm3 must be a number") from exc
    if not math.isfinite(volume) or volume <= 0:
        raise ValueError("volume_mm3 must be greater than 0")
    return volume


def _parse_max_dim(value: Any, obb_dimensions: Any) -> float:
    if value not in (None, ""):
        try:
            dim = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("max_dim_mm must be a number") from exc
        if math.isfinite(dim) and dim > 0:
            return dim
    numbers = [
        float(part)
        for part in str(obb_dimensions or "").replace("×", "x").split("x")
        if part.strip()
    ]
    if not numbers:
        raise ValueError("max_dim_mm or obb_dimensions_mm is required")
    return max(numbers)


def _find_uploaded_file(file_id: str) -> Path | None:
    if not file_id or any(char in file_id for char in "\\/"):
        raise ValueError("Invalid file_id")
    matches = list(UPLOAD_DIR.glob(f"{file_id}.*"))
    return matches[0] if matches else None


def _weight_kg(volume_mm3: float, density_gcm3: float) -> float:
    return round(volume_mm3 * density_gcm3 / 1_000_000, 6)


def _public_material(material: Material) -> dict[str, Any]:
    return {
        "id": material.id,
        "name": material.name,
        "density_gcm3": material.density_gcm3,
        "category": material.category,
    }


def _tier_label(tier: QuantityTier) -> str:
    if tier.max_qty is None:
        return f"{tier.min_qty}+ pcs"
    return f"{tier.min_qty}-{tier.max_qty} pcs"


def _money_line(label: str, amount_usd: float, exchange_rate: float, currency: str) -> dict[str, Any]:
    amount = round(amount_usd * exchange_rate, 2)
    return {"label": label, "amount": amount, "currency": currency, "display": _format_money(amount, currency)}


def _format_money(amount: float, currency: str) -> str:
    symbols = {"USD": "$", "CNY": "¥", "EUR": "€"}
    symbol = symbols.get(currency, f"{currency} ")
    return f"{symbol}{amount:,.2f}"


def _record_quote_inquiry(session, payload: dict[str, Any], result: dict[str, Any], *, client_ip: str | None, user_agent: str | None) -> None:
    part = result.get("part", {})
    selections = result.get("selections", {})
    total = result.get("total", {})
    inquiry = Inquiry(
        type="quote",
        material_name=selections.get("material", {}).get("name"),
        volume_mm3=part.get("volume_mm3"),
        weight_kg=part.get("weight_kg"),
        max_dim_mm=part.get("max_dim_mm"),
        tolerance_grade=selections.get("tolerance_grade", {}).get("grade"),
        quantity=selections.get("quantity"),
        total_usd=total.get("amount_usd"),
        total_display=total.get("display"),
        currency=total.get("currency"),
        stp_filename=str(payload.get("stp_filename") or part.get("stp_filename", "")),
        stp_file_path=part.get("stored_path"),
        input_params=json.dumps(payload, ensure_ascii=False),
        result=json.dumps(result, ensure_ascii=False),
        client_ip=client_ip,
        user_agent=user_agent,
    )
    session.add(inquiry)
    session.commit()
