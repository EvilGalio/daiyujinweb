"""Quote email notification service — sends internal alerts on new quotes.

Only active for allowed sites (e.g. gcnov). Never blocks the quote response.
All failures are logged to quote_email_logs and swallowed.
"""

from __future__ import annotations

import html
import os
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from database import SessionLocal
from models import QuoteEmailLog

BACKEND = Path(__file__).resolve().parents[1]
THUMB_DIR = BACKEND / "static" / "thumbnails"


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def notify_quote_submitted(
    *,
    payload: dict,
    result: dict,
    inquiry_id: int | None = None,
    client_ip: str = "",
    client_country: str = "",
    user_agent: str = "",
) -> None:
    """Internal notification: send email if site is allowed and contact is complete. Never raises."""
    try:
        _notify_impl(
            payload=payload, result=result, inquiry_id=inquiry_id,
            client_ip=client_ip, client_country=client_country, user_agent=user_agent,
        )
    except Exception:
        pass  # Never let email failure affect the quote response


def _notify_impl(**kwargs):
    enabled = _env("QUOTE_EMAIL_ENABLED", "false").lower() == "true"
    if not enabled:
        _log(status="disabled", **kwargs)
        return

    site = _site_from_payload(kwargs["payload"])
    allowed = _env("QUOTE_EMAIL_ALLOWED_SITES", "").split(",")
    allowed = [s.strip().lower() for s in allowed if s.strip()]
    if site.lower() not in allowed:
        _log(status="site_not_allowed", site=site, **kwargs)
        return

    customer_name = kwargs["result"].get("customer_name") or kwargs["payload"].get("customer_name", "")
    customer_email = kwargs["result"].get("customer_email") or kwargs["payload"].get("customer_email", "")
    if not customer_name or not customer_email:
        _log(status="missing_contact", site=site, **kwargs)
        return

    # Throttle: 8-hour dedup
    throttle_hours = int(_env("QUOTE_EMAIL_THROTTLE_HOURS", "8"))
    session = SessionLocal()
    try:
        exists = session.query(QuoteEmailLog).filter(
            QuoteEmailLog.site == site,
            QuoteEmailLog.customer_email == customer_email.lower().strip(),
            QuoteEmailLog.status == "sent",
            QuoteEmailLog.sent_at >= datetime.utcnow() - timedelta(hours=throttle_hours),
        ).first()
    finally:
        session.close()
    if exists:
        _log(status="skipped_throttled", site=site, customer_email=customer_email, **kwargs)
        return

    # Determine thumbnail first
    ctx = _build_context(**kwargs)
    thumb_path = _find_thumbnail(ctx.get("file_id", ""), ctx.get("stored_name", ""))
    if thumb_path and thumb_path.stat().st_size < 5 * 1024 * 1024:
        ctx["thumbnail_note"] = "attached"
    else:
        ctx["thumbnail_note"] = "unavailable" if not thumb_path else "skipped (too large)"

    # Build email with thumbnail status baked in
    subject = _build_subject(ctx, site)
    msg = _build_message(ctx, customer_email, site)

    # Attach thumbnail if available
    if thumb_path and ctx["thumbnail_note"] == "attached":
        with open(thumb_path, "rb") as f:
            msg.add_attachment(f.read(), maintype="image", subtype="png", filename="part-preview.png")

    # Send
    recipients_raw = _env("QUOTE_EMAIL_RECIPIENTS", "great@mfg-solution.com")
    recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

    try:
        host = _env("SMTP_HOST", "smtppro.zoho.com")
        port = int(_env("SMTP_PORT", "465"))
        username = _env("SMTP_USERNAME", "")
        password = _env("SMTP_PASSWORD", "")
        timeout = int(_env("SMTP_TIMEOUT_SECONDS", "12"))

        if not username or not password:
            _log(status="failed", error_message="SMTP credentials not configured", site=site, **kwargs)
            return

        with smtplib.SMTP_SSL(host, port, timeout=timeout) as smtp:
            smtp.login(username, password)
            smtp.send_message(msg)

        _log(status="sent", site=site, customer_email=customer_email, customer_name=customer_name,
             recipient=recipients_raw, subject=subject, **kwargs)
    except smtplib.SMTPAuthenticationError as e:
        _log(status="failed", error_message=f"Auth failed: {type(e).__name__}", site=site, **kwargs)
    except Exception as e:
        _log(status="failed", error_message=f"{type(e).__name__}: {str(e)[:500]}", site=site, **kwargs)


def _site_from_payload(payload: dict) -> str:
    return str(payload.get("site", "") or payload.get("theme", "") or "default").strip()


def _build_context(*, payload: dict, result: dict, inquiry_id: int | None, client_ip: str, client_country: str, user_agent: str, **_) -> dict:
    part = result.get("part", {}) or {}
    sel = result.get("selections", {}) or {}
    unit = result.get("unit_estimate", {}) or {}
    total = result.get("total_estimate", {}) or {}

    return {
        "customer_name": result.get("customer_name") or payload.get("customer_name", ""),
        "customer_email": result.get("customer_email") or payload.get("customer_email", ""),
        "site": _site_from_payload(payload),
        "submitted_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "client_ip": client_ip,
        "client_country": client_country,
        "user_agent": user_agent,
        "part_name": part.get("name") or payload.get("part_name", ""),
        "stp_filename": part.get("stp_filename") or payload.get("stp_filename", ""),
        "obb_dimensions": part.get("obb_dimensions_mm", ""),
        "weight_kg": part.get("stock_weight_kg", ""),
        "volume_mm3": part.get("volume_mm3") or payload.get("volume_mm3", ""),
        "material": sel.get("material", "") or "",
        "material_category": sel.get("material_category", "") or "",
        "process": sel.get("process", "") or "",
        "postprocess": sel.get("postprocess_public_label", "") or sel.get("postprocess_group", "") or "",
        "tolerance": sel.get("tolerance_grade", "") or sel.get("tolerance_label", "") or "",
        "quantity": sel.get("quantity", "") or payload.get("quantity", ""),
        "currency": result.get("currency", ""),
        "unit_display": unit.get("display", ""),
        "total_display": total.get("display", ""),
        "valid_until": result.get("valid_until", ""),
        "inquiry_id": str(inquiry_id) if inquiry_id else "-",
        "batch_id": payload.get("batch_id", "")[:8] if payload.get("batch_id") else "",
        "batch_index": payload.get("batch_item_index", ""),
        "batch_count": payload.get("batch_item_count", ""),
        "file_id": part.get("file_id") or payload.get("file_id", ""),
        "stored_name": part.get("stored_name", ""),
        "thumbnail_note": "",
    }


def _build_subject(ctx: dict, site: str) -> str:
    prefix = {"gcnov": "GCNOV"}.get(site.lower(), site.upper())
    name = ctx["customer_name"] or "Customer"
    part = ctx["part_name"] or ctx["stp_filename"] or "Part"
    total = ctx["total_display"] or "-"
    subject = f"[{prefix} Online Quote] {name} - {part} - {total}"
    return subject[:120]


def _build_message(ctx: dict, customer_email: str, site: str) -> EmailMessage:
    from_addr = _env("SMTP_FROM", _env("SMTP_USERNAME", ""))
    from_name = _env("SMTP_FROM_NAME", "GCNOV Online Quote")
    recipients_raw = _env("QUOTE_EMAIL_RECIPIENTS", "great@mfg-solution.com")
    recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

    msg = EmailMessage()
    msg["From"] = f"{from_name} <{from_addr}>"
    msg["To"] = ", ".join(recipients)
    msg["Reply-To"] = customer_email
    msg["Subject"] = _build_subject(ctx, site)

    body = _render_text(ctx)
    html = _render_html(ctx)
    msg.set_content(body)
    msg.add_alternative(html, subtype="html")
    return msg


def _h(v):
    return html.escape(str(v or "-"), quote=False)


def _render_text(ctx: dict) -> str:
    return f"""A new online quote was submitted from {ctx['site'].upper()}.
This is an internal notification. Do not forward externally without review.

Customer: {_v(ctx,'customer_name')}
Email: {_v(ctx,'customer_email')}
Site: {_v(ctx,'site')}
Submitted: {_v(ctx,'submitted_at')}
IP: {_v(ctx,'client_ip')}{_v2(ctx,'client_country',' / ')}{_v(ctx,'client_country')}

Part: {_v(ctx,'part_name')}
File: {_v(ctx,'stp_filename')}
Size: {_v(ctx,'obb_dimensions')}
Weight: {_v(ctx,'weight_kg')} kg
Volume: {_v(ctx,'volume_mm3')} mm³

Material: {_v(ctx,'material')}
Process: {_v(ctx,'process')}
Postprocess: {_v(ctx,'postprocess')}
Tolerance: {_v(ctx,'tolerance')}
Quantity: {_v(ctx,'quantity')} pcs

Estimate: {_v(ctx,'unit_display')} / {_v(ctx,'total_display')}
Valid until: {_v(ctx,'valid_until')}

Inquiry ID: {_v(ctx,'inquiry_id')}
Batch: {_f(ctx,'batch_index')}/{_f(ctx,'batch_count')} ({_v(ctx,'batch_id')})
Thumbnail: {_v(ctx,'thumbnail_note') or 'attached' if ctx.get('thumbnail_note') is None else ctx['thumbnail_note']}

This online estimate is for early cost evaluation only. Final pricing may vary based on drawing review, exact material grade, tolerance, finishing requirements, inspection needs, and lead time."""


def _render_html(ctx: dict) -> str:
    rows = [
        ("Customer", _h(ctx.get("customer_name"))),
        ("Email", _h(ctx.get("customer_email"))),
        ("Site", _h(ctx.get("site"))),
        ("Submitted", _h(ctx.get("submitted_at"))),
        ("IP", f"{_h(ctx.get('client_ip'))}{_v2(ctx,'client_country',' / ')}{_h(ctx.get('client_country'))}"),
    ]
    tbody = "".join(f"<tr><td style='color:#6b7280;padding:2px 8px 2px 0'>{k}</td><td style='padding:2px 0'>{v}</td></tr>" for k, v in rows)

    part_rows = [
        ("Part", _h(ctx.get("part_name"))),
        ("File", _h(ctx.get("stp_filename"))),
        ("Size", _h(ctx.get("obb_dimensions"))),
        ("Weight", f"{_h(ctx.get('weight_kg'))} kg"),
        ("Volume", f"{_h(ctx.get('volume_mm3'))} mm³"),
    ]
    pbody = "".join(f"<tr><td style='color:#6b7280;padding:2px 8px 2px 0'>{k}</td><td style='padding:2px 0'>{v}</td></tr>" for k, v in part_rows)

    quote_rows = [
        ("Material", _h(ctx.get("material"))),
        ("Process", _h(ctx.get("process"))),
        ("Postprocess", _h(ctx.get("postprocess"))),
        ("Tolerance", _h(ctx.get("tolerance"))),
        ("Quantity", _h(ctx.get("quantity"))),
        ("Unit", _h(ctx.get("unit_display"))),
        ("Total", _h(ctx.get("total_display"))),
        ("Valid until", _h(ctx.get("valid_until"))),
    ]
    qbody = "".join(f"<tr><td style='color:#6b7280;padding:2px 8px 2px 0'>{k}</td><td style='padding:2px 0'>{v}</td></tr>" for k, v in quote_rows)

    return f"""<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;color:#1a1d23;max-width:600px">
<h3 style="margin-bottom:4px">New Quote — {_v(ctx,'site').upper()}</h3>
<p style="color:#6b7280;font-size:12px;margin-top:0">Internal notification. Do not forward externally without review.</p>

<h4 style="margin:16px 0 4px;color:#374151">Customer</h4>
<table style="border-collapse:collapse">{tbody}</table>

<h4 style="margin:16px 0 4px;color:#374151">Part</h4>
<table style="border-collapse:collapse">{pbody}</table>

<h4 style="margin:16px 0 4px;color:#374151">Quote</h4>
<table style="border-collapse:collapse">{qbody}</table>

<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px">
Inquiry ID: {_v(ctx,'inquiry_id')} · Thumbnail: {_v(ctx,'thumbnail_note') or 'attached' if ctx.get('thumbnail_note') is None else ctx['thumbnail_note']}<br>
This online estimate is for early cost evaluation only.
</div></body></html>"""


def _find_thumbnail(file_id: str, stored_name: str) -> Path | None:
    if not file_id:
        return None
    patterns = [
        THUMB_DIR / f"{file_id}.png",
        THUMB_DIR / f"{file_id}_*.png",
    ]
    if stored_name:
        patterns.append(THUMB_DIR / f"{stored_name}.png")
    for p in patterns:
        if "*" in p.name:
            matches = [m for m in THUMB_DIR.glob(p.name) if m.exists()]
        elif p.exists():
            matches = [p]
        else:
            continue
        if matches:
            return max(matches, key=lambda x: x.stat().st_mtime)
    return None


def _log(status: str, **kwargs):
    try:
        payload = kwargs.get("payload", {})
        result = kwargs.get("result", {})
        site = kwargs.get("site") or (kwargs.get("payload", {}).get("site") or kwargs.get("payload", {}).get("theme", ""))
        customer_email = kwargs.get("customer_email") or kwargs.get("payload", {}).get("customer_email", "")
        customer_name = kwargs.get("customer_name") or kwargs.get("payload", {}).get("customer_name", "")
        recipient = kwargs.get("recipient") or os.environ.get("QUOTE_EMAIL_RECIPIENTS", "")
        session = SessionLocal()
        log = QuoteEmailLog(
            inquiry_id=kwargs.get("inquiry_id"),
            site=site,
            customer_email=customer_email,
            customer_name=customer_name,
            recipient=recipient,
            subject=kwargs.get("subject", ""),
            status=status,
            error_message=(kwargs.get("error_message", "") or "")[:2000],
            sent_at=datetime.now() if status == "sent" else None,
        )
        session.add(log)
        session.commit()
    except Exception:
        pass
    finally:
        try:
            session.close()
        except Exception:
            pass


def _v(ctx, key):
    return str(ctx.get(key, "-") or "-")

def _f(ctx, key):
    v = ctx.get(key)
    return str(v) if v else "-"

def _v2(ctx, key, prefix):
    v = ctx.get(key)
    return prefix if v else ""
