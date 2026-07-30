"""Signed Quote references and the server-to-server NextGen handoff bridge."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from database import SessionLocal
from models import Inquiry


NEXTGEN_API_BASE_URL = "http://127.0.0.1:5400/api/v2"
NEXTGEN_COMPANY_CODE = "daiyujin"
NEXTGEN_CUSTOMER_PORTAL_URL = "https://portal.daiyujin.dpdns.org"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
LEGACY_UPLOAD_ROOT = BACKEND_ROOT / "uploads"


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


def _nextgen_api_base() -> str:
    value = os.environ.get("NEXTGEN_API_BASE_URL", NEXTGEN_API_BASE_URL).strip()
    if value != NEXTGEN_API_BASE_URL:
        raise QuoteBridgeUnavailable(
            "NEXTGEN_API_BASE_URL must use the reviewed NextGen loopback endpoint"
        )
    return value


def _nextgen_company_code() -> str:
    value = os.environ.get("NEXTGEN_COMPANY_CODE", NEXTGEN_COMPANY_CODE).strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,39}", value):
        raise QuoteBridgeUnavailable("NEXTGEN_COMPANY_CODE is invalid")
    return value


def _expected_portal_origin() -> str:
    value = os.environ.get(
        "NEXTGEN_CUSTOMER_PORTAL_URL",
        NEXTGEN_CUSTOMER_PORTAL_URL,
    ).strip()
    try:
        parsed = urlsplit(value)
        parsed_port = parsed.port
    except ValueError as exc:
        raise QuoteBridgeUnavailable(
            "NEXTGEN_CUSTOMER_PORTAL_URL is invalid"
        ) from exc
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed_port == 0
        or value not in {origin, f"{origin}/"}
    ):
        raise QuoteBridgeUnavailable("NEXTGEN_CUSTOMER_PORTAL_URL is invalid")
    return origin


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        decoded = base64.urlsafe_b64decode((value + padding).encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc
    if _b64encode(decoded) != value:
        raise QuoteReferenceError("Quote reference is invalid")
    return decoded


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


def create_file_receipt(file_id: str) -> str:
    try:
        canonical_file_id = str(uuid.UUID(str(file_id).strip().lower()))
    except ValueError as exc:
        raise QuoteReferenceError("File receipt input is invalid") from exc
    payload = json.dumps(
        {
            "file_id": canonical_file_id,
            "issued_at": int(time.time()),
            "purpose": "legacy-upload",
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def verify_file_receipt(receipt: str) -> str:
    try:
        payload_text, signature_text = str(receipt).strip().split(".", 1)
    except ValueError as exc:
        raise QuoteReferenceError("File receipt is invalid") from exc
    payload = _b64decode(payload_text)
    supplied = _b64decode(signature_text)
    expected = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(supplied, expected):
        raise QuoteReferenceError("File receipt is invalid")
    try:
        decoded = json.loads(payload.decode("utf-8"))
        file_id = str(uuid.UUID(str(decoded["file_id"]).strip().lower()))
        issued_at = int(decoded["issued_at"])
        purpose = str(decoded["purpose"])
    except (
        KeyError,
        TypeError,
        ValueError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as exc:
        raise QuoteReferenceError("File receipt is invalid") from exc
    now = int(time.time())
    ttl = int(
        os.environ.get(
            "QUOTE_FILE_RECEIPT_TTL_SECONDS",
            str(7 * 24 * 60 * 60),
        )
    )
    if (
        purpose != "legacy-upload"
        or ttl < 300
        or issued_at > now + 300
        or now - issued_at > ttl
    ):
        raise QuoteReferenceError("File receipt has expired")
    return file_id


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
    try:
        receipt_file_id = verify_file_receipt(
            str(input_payload.get("file_receipt") or "")
        )
    except QuoteReferenceError:
        return []
    if not hmac.compare_digest(receipt_file_id, file_id):
        return []
    filename = Path(str(input_payload.get("stp_filename") or inquiry.stp_filename or "")).name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".stp", ".step", ".igs", ".iges"}:
        return []
    upload_root = LEGACY_UPLOAD_ROOT.resolve()
    quote_job_root = Path(
        os.environ.get(
            "QUOTE_JOB_STORAGE_ROOT",
            str(upload_root / "quote-jobs"),
        )
    ).resolve()
    candidate_roots = (
        (
            upload_root,
            [
                upload_root / f"{file_id}{suffix}",
                *sorted(upload_root.glob(f"{file_id}_*{suffix}")),
            ],
        ),
        (
            quote_job_root,
            sorted(quote_job_root.glob(f"*/parts/{file_id}_*{suffix}")),
        ),
    )
    stored_path: Path | None = None
    for allowed_root, candidates in candidate_roots:
        for candidate in candidates:
            try:
                resolved = candidate.resolve(strict=True)
                resolved.relative_to(allowed_root)
            except (FileNotFoundError, OSError, ValueError):
                continue
            is_junction = getattr(candidate, "is_junction", lambda: False)
            if (
                resolved.is_file()
                and not candidate.is_symlink()
                and not is_junction()
            ):
                stored_path = resolved
                break
        if stored_path is not None:
            break
    if stored_path is None:
        return []
    stored_name = stored_path.name
    prefix = f"{file_id}_"
    original_filename = (
        stored_name[len(prefix) :]
        if stored_name.lower().startswith(prefix)
        else filename
    )
    original_filename = Path(original_filename).name
    if Path(original_filename).suffix.lower() != suffix:
        return []
    mime_type = "model/iges" if suffix in {".igs", ".iges"} else "model/step"
    return [
        {
            "file_id": file_id,
            "original_filename": original_filename,
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
) -> dict[str, Any]:
    inquiry_id = verify_quote_reference(quote_reference)
    session = SessionLocal()
    try:
        inquiry = session.get(Inquiry, inquiry_id)
        if inquiry is None:
            raise QuoteHandoffError("Quote reference was not found")
        payload = {
            "brand_code": _nextgen_company_code(),
            "source": "online_quote",
            "source_reference": f"legacy-quote-{inquiry.record_id}",
            "context": _handoff_context(inquiry),
            "contact_email": inquiry.customer_email,
        }
    finally:
        session.close()
        SessionLocal.remove()

    api_base = _nextgen_api_base()
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
    destination = urlsplit(str(result["sign_up_url"]))
    destination_origin = f"{destination.scheme}://{destination.netloc}"
    if destination_origin != _expected_portal_origin():
        raise QuoteBridgeUnavailable("Customer Portal returned an unexpected origin")
    return result
