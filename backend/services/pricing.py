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
            type="formal_quote",
            material_name=payload.get("material_id", ""),
            quantity=payload.get("quantity"),
            total_usd=None,
            total_display=payload.get("currency", "USD"),
            currency=payload.get("currency", "USD"),
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
            "message": "Your formal quote request has been received. Our engineering team will review and respond within 1 business day.",
        }
    finally:
        session.close()
        SessionLocal.remove()


def _record_inquiry(payload: dict, result: dict, client_ip: str, user_agent: str) -> None:
    session = SessionLocal()
    try:
        total = result.get("total", {})
        inquiry = Inquiry(
            type="quote",
            material_name=payload.get("material_id", ""),
            volume_mm3=payload.get("volume_mm3"),
            weight_kg=result.get("part", {}).get("stock_weight_kg"),
            max_dim_mm=max(result.get("part", {}).get("obb_lwh_mm", [0])),
            tolerance_grade=payload.get("tolerance_grade", "GENERAL"),
            quantity=payload.get("quantity"),
            total_usd=total.get("amount") if total.get("currency") == "USD" else None,
            total_display=total.get("display", ""),
            currency=total.get("currency", ""),
            stp_filename=payload.get("stp_filename"),
            stp_file_path=None,
            client_ip=client_ip,
            user_agent=user_agent,
            input_params=json.dumps({
                "model_version": "v2.1_additive",
                "selections": result.get("selections"),
                "formula": result.get("formula"),
            }, ensure_ascii=False),
            result=json.dumps(result, ensure_ascii=False),
        )
        session.add(inquiry)
        session.commit()
    finally:
        session.close()
        SessionLocal.remove()
