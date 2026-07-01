"""Quote pricing — facade to v2.1 calculator.

Delegates calculation to quote_calculator_v2.
Preserves inquiry logging and formal quote request.
No random perturbation.
"""

from __future__ import annotations

import json
from typing import Any

from database import SessionLocal
from models import Inquiry
from services.quote_calculator_v2 import calculate_quote_v2, get_quote_options_v2, public_quote_response


def get_quote_options() -> dict:
    return get_quote_options_v2()


def calculate_quote(payload: dict, *, client_ip: str = "", user_agent: str = "") -> dict:
    """Calculate quote using v2.1 additive formula, log full inquiry, return public-safe."""
    result = calculate_quote_v2(payload)
    _record_inquiry(payload, result, client_ip, user_agent)
    return public_quote_response(result)


def recalculate_weight(volume_mm3: float = 0, material_id: str = "", **_kwargs) -> dict:
    """Legacy weight recalc. V2 uses OBB, not net volume."""
    return {
        "volume_mm3": volume_mm3,
        "material_id": material_id,
        "weight_kg": None,
        "note": "Weight recalc not supported in v2.1. OBB dimensions used for quote calculation.",
    }


def request_formal_quote(payload: dict, *, client_ip: str = "", user_agent: str = "") -> dict:
    """Log a formal quote request."""
    session = SessionLocal()
    try:
        inquiry = Inquiry(
            part_name=_part_name_from_payload(payload),
            material_name=payload.get("material_id", ""),
            quantity=payload.get("quantity"),
            total_usd=None,
            total_display=payload.get("currency", "USD"),
            currency=payload.get("currency", "USD"),
            customer_name=(payload.get("customer_name") or "").strip() or None,
            customer_email=(payload.get("customer_email") or "").strip() or None,
            stp_filename=payload.get("stp_filename"),
            input_params=json.dumps(payload, ensure_ascii=False),
            result=json.dumps({}, ensure_ascii=False),
            client_ip=client_ip,
            user_agent=user_agent,
        )
        session.add(inquiry)
        session.commit()
        return {
            "status": "received",
            "inquiry_id": inquiry.record_id,
            "message": "Your formal quote request has been received. Our engineering team will review and respond within 1 business day.",
        }
    finally:
        session.close()
        SessionLocal.remove()


def _record_inquiry(payload: dict, result: dict, client_ip: str, user_agent: str) -> None:
    session = SessionLocal()
    try:
        total = result.get("total_estimate") or result.get("total", {})
        currency = total.get("currency") or result.get("currency") or payload.get("currency", "")
        contact_name = (result.get("customer_name") or payload.get("customer_name") or "").strip()
        contact_email = (result.get("customer_email") or payload.get("customer_email") or "").strip()
        obb_lwh = result.get("part", {}).get("obb_lwh_mm") or [0]
        inquiry = Inquiry(
            part_name=_part_name_from_payload(payload, result),
            material_name=payload.get("material_id", ""),
            volume_mm3=payload.get("volume_mm3"),
            weight_kg=result.get("part", {}).get("stock_weight_kg"),
            max_dim_mm=max(obb_lwh),
            tolerance_grade=payload.get("tolerance_grade", "GENERAL"),
            quantity=payload.get("quantity"),
            total_usd=total.get("amount") if currency == "USD" else None,
            total_display=total.get("display", ""),
            currency=currency,
            customer_name=contact_name or None,
            customer_email=contact_email or None,
            batch_id=(payload.get("batch_id") or "").strip() or None,
            batch_item_id=(payload.get("batch_item_id") or "").strip() or None,
            batch_item_index=payload.get("batch_item_index"),
            batch_item_count=payload.get("batch_item_count"),
            stp_filename=payload.get("stp_filename"),
            client_ip=client_ip,
            user_agent=user_agent,
            input_params=json.dumps({
                "model_version": result.get("pricing_model_version", "v2.2_estimate"),
                "batch": {
                    "batch_id": payload.get("batch_id"),
                    "batch_item_id": payload.get("batch_item_id"),
                    "batch_item_index": payload.get("batch_item_index"),
                    "batch_item_count": payload.get("batch_item_count"),
                },
                "contact": {
                    "customer_name": contact_name or None,
                    "customer_email": contact_email or None,
                },
                "selections": result.get("selections"),
                "unit_estimate": result.get("unit_estimate"),
                "total_estimate": result.get("total_estimate"),
            }, ensure_ascii=False),
            result=json.dumps(result, ensure_ascii=False),
        )
        session.add(inquiry)
        session.commit()
    finally:
        session.close()
        SessionLocal.remove()


def _part_name_from_payload(payload: dict, result: dict | None = None) -> str:
    result = result or {}
    quote_result = payload.get("quote_result") if isinstance(payload.get("quote_result"), dict) else {}
    candidates = [
        payload.get("part_name"),
        (result.get("part") or {}).get("name") if isinstance(result.get("part"), dict) else None,
        (quote_result.get("part") or {}).get("name") if isinstance(quote_result.get("part"), dict) else None,
    ]
    for value in candidates:
        text = str(value or "").strip()
        if text:
            return text

    filename = (
        payload.get("stp_filename")
        or ((result.get("part") or {}).get("stp_filename") if isinstance(result.get("part"), dict) else "")
        or ((quote_result.get("part") or {}).get("stp_filename") if isinstance(quote_result.get("part"), dict) else "")
    )
    return str(filename or "").replace("\\", "/").split("/")[-1].rsplit(".", 1)[0]
