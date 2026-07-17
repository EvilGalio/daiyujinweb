"""Signed Quote references and the server-to-server NextGen handoff bridge."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from database import SessionLocal
from models import Inquiry


class QuoteHandoffError(RuntimeError):
    """Raised when a Quote cannot be transferred safely."""


class QuoteReferenceError(QuoteHandoffError):
    """Raised when a public Quote reference is invalid or expired."""


class QuoteBridgeUnavailable(QuoteHandoffError):
    """Raised when the private Portal bridge is unavailable or misconfigured."""


def _secret(name: str) -> bytes:
    value = os.environ.get(name, "").strip()
    if len(value) < 32:
        raise QuoteBridgeUnavailable(f"{name} must contain at least 32 characters")
    return value.encode("utf-8")


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode((value + padding).encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc


def create_quote_reference(inquiry_id: int) -> str:
    payload = json.dumps(
        {"inquiry_id": int(inquiry_id), "issued_at": int(time.time())},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def verify_quote_reference(reference: str) -> int:
    try:
        payload_text, signature_text = reference.strip().split(".", 1)
    except ValueError as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc
    payload = _b64decode(payload_text)
    supplied = _b64decode(signature_text)
    expected = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(supplied, expected):
        raise QuoteReferenceError("Quote reference is invalid")
    try:
        decoded = json.loads(payload.decode("utf-8"))
        inquiry_id = int(decoded["inquiry_id"])
        issued_at = int(decoded["issued_at"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc
    ttl = int(os.environ.get("QUOTE_REFERENCE_TTL_SECONDS", str(7 * 24 * 60 * 60)))
    if ttl < 300 or int(time.time()) - issued_at > ttl:
        raise QuoteReferenceError("Quote reference has expired")
    if inquiry_id < 1:
        raise QuoteReferenceError("Quote reference is invalid")
    return inquiry_id


def _json_object(raw: str | None) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _safe_file_reference(
    input_payload: dict[str, Any],
    inquiry: Inquiry,
) -> list[dict[str, str]]:
    file_id = str(input_payload.get("file_id") or "").strip().lower()
    try:
        file_id = str(uuid.UUID(file_id))
    except ValueError:
        return []
    filename = Path(str(input_payload.get("stp_filename") or inquiry.stp_filename or "")).name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".stp", ".step", ".igs", ".iges"}:
        return []
    mime_type = "model/iges" if suffix in {".igs", ".iges"} else "model/step"
    return [
        {
            "file_id": file_id,
            "original_filename": filename,
            "mime_type": mime_type,
        }
    ]


def _handoff_context(inquiry: Inquiry) -> dict[str, Any]:
    stored_input = _json_object(inquiry.input_params)
    stored_result = _json_object(inquiry.result)
    selections = stored_result.get("selections")
    if not isinstance(selections, dict):
        selections = stored_input.get("selections")
    selections = selections if isinstance(selections, dict) else {}
    total = stored_result.get("total_estimate")
    total = total if isinstance(total, dict) else {}
    estimate = total.get("amount")
    quantity = inquiry.quantity or selections.get("quantity") or 1
    return {
        "title": inquiry.part_name or "Manufacturing project",
        "part_name": inquiry.part_name or "Manufacturing part",
        "quantity_tiers": [int(quantity)],
        "material": str(selections.get("material") or inquiry.material_name or ""),
        "process": str(selections.get("process") or ""),
        "tolerance": str(selections.get("tolerance_grade") or inquiry.tolerance_grade or ""),
        "finish": str(selections.get("postprocess_group") or ""),
        "model_version": str(stored_result.get("pricing_model_version") or "legacy-online-quote"),
        "estimate_min": estimate,
        "estimate_max": estimate,
        "currency": str(total.get("currency") or inquiry.currency or "USD"),
        "input": {
            "weight_kg": inquiry.weight_kg,
            "max_dim_mm": inquiry.max_dim_mm,
            "volume_mm3": inquiry.volume_mm3,
        },
        "selections": selections,
        "warnings": (
            stored_result.get("warnings")
            if isinstance(stored_result.get("warnings"), list)
            else []
        ),
        "source_session_id": f"legacy-inquiry-{inquiry.record_id}",
        "file_references": _safe_file_reference(stored_input, inquiry),
    }


def create_nextgen_handoff(
    *,
    quote_reference: str,
    brand_code: str,
    return_url: str | None,
) -> dict[str, Any]:
    inquiry_id = verify_quote_reference(quote_reference)
    session = SessionLocal()
    try:
        inquiry = session.get(Inquiry, inquiry_id)
        if inquiry is None:
            raise QuoteHandoffError("Quote reference was not found")
        payload = {
            "brand_code": brand_code,
            "source": "online_quote",
            "source_reference": f"legacy-quote-{inquiry.record_id}",
            "context": _handoff_context(inquiry),
            "contact_email": inquiry.customer_email,
            "return_url": return_url,
        }
    finally:
        session.close()
        SessionLocal.remove()

    api_base = os.environ.get(
        "NEXTGEN_API_BASE_URL",
        "http://127.0.0.1:5300/api/v2",
    ).strip().rstrip("/")
    if not api_base.startswith(("http://127.0.0.1:", "http://localhost:", "https://")):
        raise QuoteBridgeUnavailable("NEXTGEN_API_BASE_URL is not allowed")
    body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    bridge_secret = _secret("NEXTGEN_LEGACY_HANDOFF_SECRET").decode("utf-8")
    outbound = urllib.request.Request(
        f"{api_base}/public/handoffs",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Idempotency-Key": f"legacy-quote-{inquiry_id}",
            "X-Legacy-Handoff-Secret": bridge_secret,
        },
    )
    try:
        with urllib.request.urlopen(outbound, timeout=12) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise QuoteBridgeUnavailable(
            f"Customer Portal rejected the handoff ({exc.code})"
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise QuoteBridgeUnavailable("Customer Portal is temporarily unavailable") from exc
    except json.JSONDecodeError as exc:
        raise QuoteBridgeUnavailable("Customer Portal returned an invalid response") from exc
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        result = result["data"]
    if not isinstance(result, dict) or not result.get("sign_up_url"):
        raise QuoteBridgeUnavailable("Customer Portal did not return a sign-up link")
    return result
