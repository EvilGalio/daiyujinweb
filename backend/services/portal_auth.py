"""Order Portal — auth + orders API."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from database import SessionLocal
from services.portal_audit import log_portal_action, list_portal_audit_logs
from services.portal_events import emit_portal_event, query_visible_events

logger = logging.getLogger(__name__)
from models import PortalSession, PortalUser, PortalOrder, PortalOrderUpdate, PortalOrderMedia, PortalMessage, PortalAuditLog, PortalEvent, PortalSecurityLog

from pathlib import Path

MEDIA_DIR = Path(__file__).resolve().parents[1] / "private" / "order_media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "thumbs").mkdir(exist_ok=True)


def _portal_ticket_secret() -> str:
    from flask import current_app
    key = (
        current_app.config.get("SECRET_KEY")
        or os.environ.get("PORTAL_TICKET_SECRET")
        or os.environ.get("SECRET_KEY")
        or "portal-key-change-me"
    )
    return str(key)


def _media_ticket_serializer():
    from itsdangerous import URLSafeTimedSerializer
    return URLSafeTimedSerializer(_portal_ticket_secret(), salt="portal-media-ticket")

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024

portal_bp = Blueprint("portal", __name__, url_prefix="/api/portal")

PORTAL_ALLOWED_ORIGINS = {
    "https://daiyujin.dpdns.org",
    "https://mfg-solution.com",
    "https://gcindus.com",
    "https://gcnov.com",
}


@portal_bp.before_request
def _handle_portal_preflight():
    if request.method == "OPTIONS":
        return ("", 204)


@portal_bp.after_request
def _add_security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if request and request.endpoint != "portal.portal_events_stream":
        resp.headers["Cache-Control"] = "no-store"
    origin = request.headers.get("Origin", "")
    if origin in PORTAL_ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Last-Event-ID"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


SESSION_HOURS = 24
_login_attempts: dict[str, list[float]] = defaultdict(list)

VALID_STAGES = {
    "order_confirmed",
    "material_ready",
    "machining",
    "surface_treatment",
    "quality_inspection",
    "packing",
    "shipped",
    "received",
}
VALID_STATUSES = {"active", "on_hold", "shipped", "delivered", "cancelled"}  # legacy, kept for compat
VALID_MANUAL_STATUSES = {"normal", "complaint", "on_hold", "cancelled"}
VALID_SHIPPING_METHODS = {"DHL", "FedEx", "Sea", "Other"}
VALID_COMPLAINT_STATUSES = {"open", "reviewing", "resolved", "closed"}

ALLOWED_ATTACHMENTS = {
    ".jpg":  ("image/jpeg",        "image", 10 * 1024 * 1024),
    ".jpeg": ("image/jpeg",        "image", 10 * 1024 * 1024),
    ".png":  ("image/png",         "image", 10 * 1024 * 1024),
    ".webp": ("image/webp",        "image", 10 * 1024 * 1024),
    ".pdf":  ("application/pdf",   "pdf",   30 * 1024 * 1024),
    ".mp4":  ("video/mp4",         "video", 100 * 1024 * 1024),
    ".webm": ("video/webm",        "video", 100 * 1024 * 1024),
    ".mov":  ("video/quicktime",   "video", 100 * 1024 * 1024),
}

# Kept for backward compat — upload validation uses ALLOWED_ATTACHMENTS now
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXT  = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _validate_progress(val):
    if val is None:
        return None
    try:
        n = int(val)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, n))


def _parse_date(value):
    """Parse a YYYY-MM-DD string or date-like value into a date object."""
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _display_status(order) -> str:
    """Compute the display status for an order (backend-canonical)."""
    manual = (getattr(order, "manual_status", None) or "normal").lower()
    if manual in {"on_hold", "complaint", "cancelled"}:
        return manual
    due = _parse_date(order.estimated_delivery_date)
    if due and due < datetime.utcnow().date() and order.current_stage != "received":
        return "delayed"
    return "normal"


def _order_summary(order, customer=None, sales=None) -> dict:
    """Return a consistent order summary dict for all list/detail endpoints."""
    data = {
        "id": order.id,
        "order_no": order.order_no,
        "title": order.title,
        "po_number": order.po_number,
        "current_stage": order.current_stage,
        "status": order.status,
        "manual_status": getattr(order, "manual_status", "normal") or "normal",
        "display_status": _display_status(order),
        "estimated_delivery_date": order.estimated_delivery_date,
        "shipping_method": getattr(order, "shipping_method", None),
        "shipping_tracking_no": order.shipping_tracking_no,
        "customer_visible_note": order.customer_visible_note,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
    }
    if customer:
        data["customer_name"] = customer.display_name or customer.email
        data["customer_email"] = customer.email
    if sales:
        data["sales_name"] = sales.display_name or sales.email
        data["sales_email"] = sales.email
    return data


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _client_ip() -> str:
    cf = request.headers.get("CF-Connecting-IP", "")
    if cf:
        return cf.strip()
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or ""


def _current_user():
    """Return (user_dict, None) or (None, error_response)."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None, (jsonify({"error": True, "message": "Authentication required"}), 401)
    token = auth[7:]
    token_hash = _hash_token(token)

    session = SessionLocal()
    try:
        s = session.query(PortalSession).filter(
            PortalSession.token_hash == token_hash,
            PortalSession.revoked_at.is_(None),
            PortalSession.expires_at > datetime.utcnow(),
        ).first()
        if not s:
            return None, (jsonify({"error": True, "message": "Invalid or expired session"}), 401)

        now = datetime.utcnow()
        last_seen = s.last_seen_at or s.created_at or now
        idle_elapsed = (now - last_seen).total_seconds()
        u = session.query(PortalUser).filter_by(id=s.user_id).first()
        if not u or u.status != "active":
            return None, (jsonify({"error": True, "message": "Account is disabled or not found"}), 401)
        if u.locked_until and u.locked_until > now:
            return None, (jsonify({"error": True, "message": "Account is temporarily locked"}), 429)
        if s.session_version != u.session_version:
            return None, (jsonify({"error": True, "message": "Session expired due to security change"}), 401)
        if idle_elapsed > 7200:
            s.revoked_at = now
            s.revoked_reason = "idle_timeout"
            session.commit()
            return None, (jsonify({"error": True, "message": "Session expired due to inactivity"}), 401)

        s.last_seen_at = now
        s.last_ip = _client_ip()
        s.last_user_agent = (request.user_agent.string or "")[:255] if request and hasattr(request, "user_agent") else ""
        session.commit()
        return {"id": u.id, "email": u.email, "role": u.role, "display_name": u.display_name, "must_change_password": u.must_change_password, "_token": token}, None
    finally:
        session.close()


def _user_json(u) -> dict:
    return {"id": u.id, "email": u.email, "role": u.role, "display_name": u.display_name, "must_change_password": u.must_change_password}


def _enforce_password_changed(u):
    """Block endpoints if user must change password. Call after _current_user."""
    if u.get("must_change_password"):
        return jsonify({"error": True, "code": "password_change_required", "message": "Please change your password first."}), 403
    return None


def _require_authenticated():
    """Like _current_user but also blocks password-change-required users."""
    u, err = _current_user()
    if err: return None, err
    block = _enforce_password_changed(u)
    if block: return None, block
    return u, None


def _require_role(allowed):
    """Return error if current user not in allowed roles or must change password."""
    user, err = _current_user()
    if err:
        return None, err
    if user.get("must_change_password"):
        return None, (jsonify({"error": True, "code": "password_change_required", "message": "Please change your password first."}), 403)
    if user["role"] not in allowed:
        return None, (jsonify({"error": True, "message": "Forbidden"}), 403)
    return user, None


PORTAL_SITE_PREFIXES = {
    "mfg": "MFG",
    "gcindus": "GCINDUS",
    "gcnov": "GCNOV",
    "default": "DYJ",
}


def _portal_site_from_request(data=None):
    data = data or {}

    origin = (request.headers.get("Origin") or request.headers.get("Referer") or "").lower()
    if "mfg-solution.com" in origin:
        return "mfg"
    if "gcindus.com" in origin:
        return "gcindus"
    if "gcnov" in origin:
        return "gcnov"

    raw = (data.get("site") or data.get("theme") or "").strip().lower()
    if raw in PORTAL_SITE_PREFIXES:
        return raw

    return "default"


def _order_no(site="default"):
    site = site if site in PORTAL_SITE_PREFIXES else "default"
    prefix = PORTAL_SITE_PREFIXES[site]
    for _ in range(5):
        no = f"{prefix}-{datetime.utcnow().strftime('%Y%m%d')}-{random.randint(1000,9999)}"
        session = SessionLocal()
        try:
            if not session.query(PortalOrder).filter_by(order_no=no).first():
                return no
        finally:
            session.close()
    return f"{prefix}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{random.randint(0,99):02d}"


# ══════════════════════════════════════════════════
# Auth
# ══════════════════════════════════════════════════

@portal_bp.post("/auth/login")
def portal_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": True, "message": "Email and password are required"}), 400

    ip = _client_ip()
    ua = (request.user_agent.string or "")[:255] if request and hasattr(request, "user_agent") else ""

    session = SessionLocal()
    try:
        u = session.query(PortalUser).filter_by(email=email).first()

        # Check lock
        if u and u.locked_until and u.locked_until > datetime.utcnow():
            session.add(PortalSecurityLog(event_type="login_blocked", email=email, user_id=u.id, ip=ip, user_agent=ua, success=False, reason="account_locked"))
            session.commit()
            return jsonify({"error": True, "message": "Account is temporarily locked. Please try again later."}), 429

        # Check rate limit: 5 failures in 10 min per email
        cutoff = datetime.utcnow() - timedelta(minutes=10)
        recent = session.query(PortalSecurityLog).filter(
            PortalSecurityLog.email == email,
            PortalSecurityLog.event_type == "login_failed",
            PortalSecurityLog.created_at > cutoff
        ).count()
        if recent >= 5:
            if u:
                mins = 60 if recent >= 10 else 15
                u.locked_until = datetime.utcnow() + timedelta(minutes=mins)
                session.commit()
                session.add(PortalSecurityLog(event_type="login_locked", email=email, user_id=u.id, ip=ip, user_agent=ua, success=False, reason=f"locked_{mins}min"))
                session.commit()
            return jsonify({"error": True, "message": "Too many attempts. Please try again later."}), 429

        if not u or not check_password_hash(u.password_hash, password):
            session.add(PortalSecurityLog(event_type="login_failed", email=email, user_id=u.id if u else None, ip=ip, user_agent=ua, success=False, reason="invalid_credentials"))
            if u:
                u.failed_login_count = (u.failed_login_count or 0) + 1
                u.last_failed_login_at = datetime.utcnow()
            session.commit()
            return jsonify({"error": True, "message": "Invalid credentials"}), 401

        if u.status != "active":
            session.add(PortalSecurityLog(event_type="login_blocked", email=email, user_id=u.id, ip=ip, user_agent=ua, success=False, reason="account_disabled"))
            session.commit()
            return jsonify({"error": True, "message": "Account is disabled"}), 401

        u.failed_login_count = 0
        u.last_login_at = datetime.utcnow()
        u.locked_until = None
        token = secrets.token_hex(32)
        session.add(PortalSession(
            user_id=u.id, token_hash=_hash_token(token),
            expires_at=datetime.utcnow() + timedelta(hours=SESSION_HOURS),
            session_version=u.session_version,
            client_ip=ip, user_agent=request.headers.get("User-Agent"),
        ))
        u.last_login_at = datetime.utcnow()
        session.add(PortalSecurityLog(event_type="login_success", email=email, user_id=u.id, ip=ip, user_agent=ua, success=True))
        session.commit()
        return jsonify({"error": False, "token": token, "user": _user_json(u)})
    finally:
        session.close()


@portal_bp.post("/auth/logout")
def portal_logout():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        session = SessionLocal()
        try:
            s = session.query(PortalSession).filter_by(token_hash=_hash_token(auth[7:])).first()
            if s:
                s.revoked_at = datetime.utcnow()
                session.commit()
        finally:
            session.close()
    return jsonify({"error": False, "message": "Logged out"})


@portal_bp.get("/auth/me")
def portal_me():
    u, err = _current_user()
    if err:
        return err
    safe = {k: v for k, v in u.items() if k != "_token"}
    return jsonify({"error": False, "user": safe})


@portal_bp.post("/auth/change-password")
def portal_change_password():
    u, err = _current_user()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    current = data.get("current", "")
    new_pw = data.get("new", "")
    if len(new_pw) < 12:
        return jsonify({"error": True, "message": "New password must be at least 12 characters"}), 400

    session = SessionLocal()
    try:
        ou = session.query(PortalUser).filter_by(id=u["id"]).first()
        if not ou or not check_password_hash(ou.password_hash, current):
            return jsonify({"error": True, "message": "Current password is incorrect"}), 401
        ou.password_hash = generate_password_hash(new_pw)
        ou.must_change_password = False
        ou.session_version += 1
        ou.password_changed_at = datetime.utcnow()
        # Bump current session version so it stays valid
        current_hash = _hash_token(u.get("_token", ""))
        current = session.query(PortalSession).filter_by(user_id=ou.id, token_hash=current_hash, revoked_at=None).first()
        if current:
            current.session_version = ou.session_version
            current.last_seen_at = datetime.utcnow()
        # Revoke all other sessions
        session.query(PortalSession).filter(
            PortalSession.user_id == ou.id,
            PortalSession.revoked_at.is_(None),
            PortalSession.token_hash != current_hash
        ).update({"revoked_at": datetime.utcnow(), "revoked_reason": "password_changed"})
        session.commit()
        return jsonify({"error": False, "message": "Password changed"})
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Sales — customers
# ══════════════════════════════════════════════════

@portal_bp.get("/sales/customers")
def sales_customers():
    u, err = _require_role(("sales", "admin"))
    if err: return err

    session = SessionLocal()
    try:
        q = session.query(PortalUser).filter(PortalUser.role == "customer")
        if u["role"] == "sales":
            q = q.filter(PortalUser.assigned_sales_id == u["id"])
        rows = q.order_by(PortalUser.created_at.desc()).limit(100).all()
        return jsonify({"error": False, "customers": [
            {"id": c.id, "email": c.email, "display_name": c.display_name, "company_name": c.company_name, "status": c.status,
             "created_at": c.created_at.isoformat() if c.created_at else None}
            for c in rows]})
    finally:
        session.close()


@portal_bp.post("/sales/customers")
def sales_create_customer():
    u, err = _require_role(("sales", "admin"))
    if err: return err

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    display_name = (data.get("display_name") or "").strip()
    if not email:
        return jsonify({"error": True, "message": "Email is required"}), 400

    session = SessionLocal()
    try:
        existing = session.query(PortalUser).filter_by(email=email, role="customer").first()
        if existing:
            if u["role"] != "admin" and existing.assigned_sales_id != u["id"]:
                return jsonify({"error": True, "message": "Customer already exists and is assigned to another sales representative"}), 403
            return jsonify({"error": False, "customer": _user_json(existing)})

        pw = secrets.token_hex(8)
        c = PortalUser(
            email=email, password_hash=generate_password_hash(pw), role="customer",
            display_name=display_name or email.split("@")[0],
            assigned_sales_id=u["id"], must_change_password=True, created_by_user_id=u["id"],
        )
        session.add(c)
        log_portal_action(session, u, "sales_create_customer", entity_type="portal_user", entity_label=c.email)
        session.commit()
        return jsonify({"error": False, "customer": _user_json(c), "initial_password": pw, "user_id": c.id})
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Orders
# ══════════════════════════════════════════════════

@portal_bp.get("/orders")
def portal_orders_list():
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        q_str  = request.args.get("q", "").strip()
        stage  = request.args.get("stage", "").strip()
        d_stat = request.args.get("display_status", "").strip()

        q = session.query(PortalOrder)
        if u["role"] == "customer":
            q = q.filter(PortalOrder.customer_user_id == u["id"])
        elif u["role"] == "sales":
            q = q.filter(PortalOrder.sales_user_id == u["id"])

        if stage:
            q = q.filter(PortalOrder.current_stage == stage)
        if q_str:
            q = q.filter(
                PortalOrder.title.ilike(f"%{q_str}%")
                | PortalOrder.order_no.ilike(f"%{q_str}%")
                | PortalOrder.po_number.ilike(f"%{q_str}%")
            )
        rows = q.order_by(PortalOrder.updated_at.desc()).limit(100).all()
        customer_ids = {o.customer_user_id for o in rows if o.customer_user_id}
        customers = {c.id: c for c in session.query(PortalUser).filter(PortalUser.id.in_(customer_ids)).all()} if customer_ids else {}
        # display_status filter is done in Python (see PRD 5.10)
        results = [_order_summary(o, customer=customers.get(o.customer_user_id)) for o in rows]
        if d_stat:
            results = [r for r in results if r["display_status"] == d_stat]
        return jsonify({"error": False, "orders": results})
    finally:
        session.close()



@portal_bp.get("/orders/<int:order_id>")
def portal_order_detail(order_id):
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        o = session.query(PortalOrder).filter_by(id=order_id).first()
        if not o:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "customer" and o.customer_user_id != u["id"]:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "sales" and o.sales_user_id != u["id"] and u["role"] != "admin":
            return jsonify({"error": True, "message": "Order not found"}), 404

        cu = session.query(PortalUser).filter_by(id=o.customer_user_id).first()
        su = session.query(PortalUser).filter_by(id=o.sales_user_id).first() if o.sales_user_id else None
        detail = _order_summary(o)
        detail["customer"] = {"email": cu.email, "display_name": cu.display_name} if cu else None
        detail["sales"]    = {"email": su.email, "display_name": su.display_name} if su else None
        # complaint info (visible to all roles for status display)
        detail["complaint_status"]      = getattr(o, "complaint_status", None)
        detail["complaint_opened_at"]   = o.complaint_opened_at.isoformat() if getattr(o, "complaint_opened_at", None) else None
        detail["complaint_resolved_at"] = o.complaint_resolved_at.isoformat() if getattr(o, "complaint_resolved_at", None) else None
        return jsonify({"error": False, "order": detail})
    finally:
        session.close()



@portal_bp.post("/sales/orders")
def sales_create_order():
    u, err = _require_role(("sales", "admin"))
    if err: return err

    data = request.get_json(silent=True) or {}
    customer_email = (data.get("customer_email") or "").strip().lower()
    customer_user_id_raw = data.get("customer_user_id")
    title = (data.get("title") or "").strip()
    stage = (data.get("current_stage") or "order_confirmed").strip().lower()

    if (not customer_email and not customer_user_id_raw) or not title:
        return jsonify({"error": True, "message": "customer_email or customer_user_id, and title are required"}), 400
    if stage not in VALID_STAGES:
        return jsonify({"error": True, "message": f"Invalid stage: {stage}"}), 400

    session = SessionLocal()
    try:
        if customer_user_id_raw not in (None, ""):
            try:
                customer_user_id = int(customer_user_id_raw)
            except (TypeError, ValueError):
                return jsonify({"error": True, "message": "customer_user_id must be an integer"}), 400
            customer = session.query(PortalUser).filter_by(id=customer_user_id, role="customer").first()
        else:
            customer = session.query(PortalUser).filter_by(email=customer_email, role="customer").first()
        if not customer:
            return jsonify({"error": True, "message": "Customer not found. Create the customer first."}), 404
        if u["role"] != "admin" and customer.assigned_sales_id != u["id"]:
            return jsonify({"error": True, "message": "Customer is assigned to another sales representative"}), 403

        o = PortalOrder(
            order_no=_order_no(_portal_site_from_request(data)), customer_user_id=customer.id, sales_user_id=u["id"],
            title=title, po_number=data.get("po_number") or None, current_stage=stage,
            estimated_delivery_date=data.get("estimated_delivery_date") or None,
            customer_visible_note=data.get("customer_visible_note") or None,
            created_by_user_id=u["id"],
        )
        session.add(o)
        session.flush()
        log_portal_action(session, u, "sales_create_order", entity_type="portal_order", entity_label=f"#{o.order_no} {title}")
        emit_portal_event(session, "order_created", "order", entity_id=o.id, order_id=o.id, actor_user_id=u["id"], visibility="public", payload={"order_id": o.id, "order_no": o.order_no, "title": title, "current_stage": stage})
        session.commit()
        return jsonify({"error": False, "order": {"id": o.id, "order_no": o.order_no, "title": o.title, "current_stage": o.current_stage}})
    finally:
        session.close()


@portal_bp.get("/orders/<int:order_id>/updates")
def portal_order_updates(order_id):
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        o = session.query(PortalOrder).filter_by(id=order_id).first()
        if not o:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "customer" and o.customer_user_id != u["id"]:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "sales" and o.sales_user_id != u["id"]:
            return jsonify({"error": True, "message": "Order not found"}), 404

        show_all = u["role"] != "customer"

        q = session.query(PortalOrderUpdate).filter(PortalOrderUpdate.order_id == order_id)
        if not show_all:
            q = q.filter(PortalOrderUpdate.visible_to_customer == True)
        rows = q.order_by(PortalOrderUpdate.created_at.asc()).all()
        return jsonify({"error": False, "updates": [{
            "id": r.id, "stage_key": r.stage_key, "title": r.title,
            "message": r.message, "progress_percent": r.progress_percent,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]})
    finally:
        session.close()


@portal_bp.post("/sales/orders/<int:order_id>/updates")
def sales_add_update(order_id):
    u, err = _require_role(("sales", "admin"))
    if err: return err

    data = request.get_json(silent=True) or {}
    sk = data.get("stage_key")
    if sk and sk not in VALID_STAGES:
        return jsonify({"error": True, "message": f"Invalid stage: {sk}"}), 400

    session = SessionLocal()
    try:
        o = session.query(PortalOrder).filter_by(id=order_id).first()
        if not o:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "sales" and o.sales_user_id != u["id"]:
            return jsonify({"error": True, "message": "Forbidden"}), 403

        upd = PortalOrderUpdate(
            order_id=order_id,
            stage_key=data.get("stage_key") or None,
            title=data.get("title") or "Progress update",
            message=data.get("message") or None,
            progress_percent=_validate_progress(data.get("progress_percent")),
            visible_to_customer=data.get("visible_to_customer", True),
            created_by_user_id=u["id"],
        )
        session.add(upd)
        session.flush()
        log_portal_action(session, u, "sales_add_order_update", entity_type="portal_order", entity_id=order_id, entity_label=f"stage={sk or 'note'}")
        v = "public" if data.get("visible_to_customer", True) else "internal"
        emit_portal_event(session, "order_update_created", "order_update", entity_id=upd.id, order_id=order_id, actor_user_id=u["id"], visibility=v, payload={"order_id": order_id, "title": data.get("title", "Progress update"), "stage_key": sk, "progress_percent": data.get("progress_percent")})
        session.commit()
        return jsonify({"error": False, "update_id": upd.id})
    finally:
        session.close()


@portal_bp.patch("/sales/orders/<int:order_id>")
def sales_update_order(order_id):
    u, err = _require_role(("sales", "admin"))
    if err: return err

    data = request.get_json(silent=True) or {}
    session = SessionLocal()
    try:
        o = session.query(PortalOrder).filter_by(id=order_id).first()
        if not o:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "sales" and o.sales_user_id != u["id"]:
            return jsonify({"error": True, "message": "Forbidden"}), 403

        if "title" in data: o.title = data["title"] or None

        if "current_stage" in data:
            s = data["current_stage"]
            if s and s not in VALID_STAGES:
                return jsonify({"error": True, "message": f"Invalid stage: {s}"}), 400
            o.current_stage = s or None

        if "manual_status" in data:
            ms = (data["manual_status"] or "normal").lower()
            if ms not in VALID_MANUAL_STATUSES:
                return jsonify({"error": True, "message": f"Invalid manual_status: {ms}"}), 400
            o.manual_status = ms
            if ms == "complaint" and not getattr(o, "complaint_status", None):
                o.complaint_status = "open"
                o.complaint_opened_at = datetime.utcnow()

        if "complaint_status" in data:
            cs = (data["complaint_status"] or "").lower()
            if cs and cs not in VALID_COMPLAINT_STATUSES:
                return jsonify({"error": True, "message": f"Invalid complaint_status: {cs}"}), 400
            o.complaint_status = cs or None
            if cs == "resolved" and not getattr(o, "complaint_resolved_at", None):
                o.complaint_resolved_at = datetime.utcnow()

        if "status" in data:
            s = data["status"]
            if s and s not in VALID_STATUSES:
                return jsonify({"error": True, "message": f"Invalid status: {s}"}), 400
            o.status = s

        if "shipping_method" in data:
            sm = data["shipping_method"] or None
            if sm and sm not in VALID_SHIPPING_METHODS:
                return jsonify({"error": True, "message": f"Invalid shipping_method: {sm}"}), 400
            o.shipping_method = sm

        if "estimated_delivery_date" in data:
            raw_date = (data["estimated_delivery_date"] or "").strip()
            if raw_date and not _parse_date(raw_date):
                return jsonify({"error": True, "message": "estimated_delivery_date must be YYYY-MM-DD"}), 400
            o.estimated_delivery_date = raw_date or None
        if "shipping_tracking_no" in data: o.shipping_tracking_no = data["shipping_tracking_no"] or None

        # shipped stage: require tracking for DHL/FedEx
        if o.current_stage == "shipped" and getattr(o, "shipping_method", None) in {"DHL", "FedEx"}:
            if not o.shipping_tracking_no:
                return jsonify({"error": True, "message": "Tracking number is required for DHL/FedEx shipments"}), 400

        if "customer_visible_note" in data: o.customer_visible_note = data["customer_visible_note"] or None
        if "internal_note" in data: o.internal_note = data["internal_note"] or None
        o.updated_at = datetime.utcnow()

        # Auto-log stage change in same transaction
        if "current_stage" in data:
            session.add(PortalOrderUpdate(
                order_id=o.id, stage_key=data["current_stage"],
                title=f"Stage updated to {data['current_stage']}",
                message=data.get("update_message") or data.get("customer_visible_note") or None,
                created_by_user_id=u["id"],
            ))

        log_portal_action(session, u, "sales_update_order", entity_type="portal_order", entity_id=order_id,
            entity_label=f"stage={data.get('current_stage','')} manual_status={data.get('manual_status','')}")
        if "current_stage" in data:
            emit_portal_event(session, "order_stage_changed", "order", entity_id=order_id, order_id=order_id,
                actor_user_id=u["id"], visibility="public",
                payload={"order_id": order_id, "current_stage": data["current_stage"]})
        summary_keys = ["status", "manual_status", "estimated_delivery_date", "customer_visible_note",
                        "shipping_tracking_no", "shipping_method"]
        if any(k in data for k in summary_keys):
            emit_portal_event(session, "order_summary_changed", "order", entity_id=order_id, order_id=order_id,
                actor_user_id=u["id"], visibility="public",
                payload={"order_id": order_id, "changed_keys": [k for k in summary_keys if k in data]})
        if "internal_note" in data:
            emit_portal_event(session, "order_internal_changed", "order", entity_id=order_id, order_id=order_id,
                actor_user_id=u["id"], visibility="internal", payload={"order_id": order_id})
        if "complaint_status" in data or "manual_status" in data:
            emit_portal_event(session, "complaint_changed", "order", entity_id=order_id, order_id=order_id,
                actor_user_id=u["id"], visibility="public",
                payload={"order_id": order_id, "manual_status": o.manual_status, "complaint_status": o.complaint_status})
        session.commit()
        return jsonify({"error": False, "message": "Order updated", "order_id": o.id,
                        "manual_status": o.manual_status, "display_status": _display_status(o)})
    finally:
        session.close()



# ══════════════════════════════════════════════════
# ══════════════════════════════════════════════════
# Media — ORM-based image upload & permission-checked access
# ══════════════════════════════════════════════════

def _load_order_for_user(session, user, order_id):
    order = session.query(PortalOrder).filter_by(id=order_id).first()
    if not order:
        return None, (jsonify({"error": True, "message": "Order not found"}), 404)
    if user["role"] == "customer" and order.customer_user_id != user["id"]:
        return None, (jsonify({"error": True, "message": "Order not found"}), 404)
    if user["role"] == "sales" and order.sales_user_id != user["id"]:
        return None, (jsonify({"error": True, "message": "Order not found"}), 404)
    return order, None


@portal_bp.get("/orders/<int:order_id>/media")
def portal_order_media_list(order_id):
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err: return err

        q = session.query(PortalOrderMedia).filter_by(order_id=order.id).order_by(PortalOrderMedia.created_at.desc())
        if u["role"] == "customer":
            q = q.filter(PortalOrderMedia.visible_to_customer == True)
        rows = q.all()
        return jsonify({"error": False, "media": [{
            "id": m.id, "caption": m.caption, "filename": m.original_filename,
            "original_filename": m.original_filename, "file_kind": m.file_kind or "image",
            "mime_type": m.mime_type, "stage_key": m.stage_key,
            "file_size": m.file_size, "visible_to_customer": bool(m.visible_to_customer),
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in rows]})
    finally:
        session.close()


@portal_bp.get("/orders/<int:order_id>/media/<int:media_id>")
def portal_order_media_get(order_id, media_id):
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err: return err

        q = session.query(PortalOrderMedia).filter_by(id=media_id, order_id=order.id)
        if u["role"] == "customer":
            q = q.filter(PortalOrderMedia.visible_to_customer == True)
        media = q.first()
        if not media:
            return jsonify({"error": True, "message": "Image not found"}), 404
        stored = media.stored_filename
        if not stored:
            return jsonify({'error': True, 'message': 'Image not found'}), 404
        mime = media.mime_type or "image/jpeg"
    finally:
        session.close()

    path = MEDIA_DIR / stored
    if not path.exists():
        return jsonify({"error": True, "message": "Image not found"}), 404

    from flask import send_file
    return send_file(path, mimetype=mime, conditional=True)


@portal_bp.post("/sales/orders/<int:order_id>/media")
def sales_upload_media(order_id):
    u, err = _require_role(("sales", "admin"))
    if err: return err

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": True, "message": "No file uploaded"}), 400

    ext = Path(file.filename).suffix.lower()
    spec = ALLOWED_ATTACHMENTS.get(ext)
    if not spec:
        return jsonify({"error": True, "message": "Only jpg/png/webp/pdf/mp4/webm/mov files allowed"}), 400
    mapped_mime, file_kind, size_limit = spec

    data = file.read()
    if len(data) > size_limit:
        return jsonify({"error": True, "message": f"File too large (max {size_limit // (1024*1024)}MB for {ext})"}), 400

    session = SessionLocal()
    path = None
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err:
            return err

        count = session.query(PortalOrderMedia).filter_by(order_id=order.id).count()
        if count >= 100:
            return jsonify({"error": True, "message": "Maximum 100 attachments per order"}), 400

        stored = f"{secrets.token_hex(16)}{ext}"
        path = MEDIA_DIR / stored
        path.write_bytes(data)

        visible_raw = (request.form.get("visible_to_customer", "1") or "1").strip().lower()
        visible = visible_raw not in {"0", "false", "no", "off"}
        stage_key = request.form.get("stage_key") or order.current_stage
        if stage_key not in VALID_STAGES:
            stage_key = order.current_stage

        media = PortalOrderMedia(
            order_id=order.id,
            update_id=request.form.get("update_id") or None,
            uploaded_by_user_id=u["id"],
            stored_filename=stored,
            original_filename=Path(file.filename).name,
            mime_type=mapped_mime,
            file_size=len(data),
            file_kind=file_kind,
            stage_key=stage_key,
            caption=(request.form.get("caption") or "").strip() or None,
            visible_to_customer=visible,
        )
        session.add(media)
        session.flush()
        log_portal_action(session, u, "sales_upload_media", entity_type="portal_order_media", entity_id=order_id, entity_label=f"{stored}")
        v = "public" if visible else "internal"
        emit_portal_event(session, "media_created", "media", entity_id=media.id, order_id=order_id, actor_user_id=u["id"], visibility=v, payload={"order_id": order_id, "media_id": media.id, "visible_to_customer": visible})
        session.commit()
        return jsonify({"error": False, "media_id": media.id, "filename": media.original_filename})
    except Exception:
        session.rollback()
        if path:
            path.unlink(missing_ok=True)
        raise
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Messages — customer feedback & sales replies
# ══════════════════════════════════════════════════

@portal_bp.get("/orders/<int:order_id>/messages")
def portal_order_messages(order_id):
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err: return err

        msgs = session.query(PortalMessage).filter_by(order_id=order.id).order_by(PortalMessage.created_at.asc()).all()
        senders = {}
        for m in msgs:
            if m.sender_user_id not in senders:
                su = session.query(PortalUser).filter_by(id=m.sender_user_id).first()
                senders[m.sender_user_id] = su.display_name or su.email if su else "Unknown"

        return jsonify({"error": False, "messages": [{
            "id": m.id, "sender_name": senders.get(m.sender_user_id, "Unknown"),
            "message": m.message, "status": m.status,
            "parent_message_id": m.parent_message_id,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in msgs]})
    finally:
        session.close()


@portal_bp.post("/orders/<int:order_id>/messages")
def portal_order_create_message(order_id):
    u, err = _require_authenticated()
    if err: return err

    data = request.get_json(silent=True) or {}
    text = (data.get("message") or "").strip()
    if not text:
        return jsonify({"error": True, "message": "Message cannot be empty"}), 400

    session = SessionLocal()
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err: return err

        msg = PortalMessage(order_id=order.id, sender_user_id=u["id"], message=text, status="open")
        session.add(msg)
        session.flush()
        emit_portal_event(session, "message_created", "message", entity_id=msg.id, order_id=order.id, actor_user_id=u["id"], visibility="public", payload={"order_id": order.id, "message_id": msg.id})
        session.commit()
        return jsonify({"error": False, "message_id": msg.id})
    finally:
        session.close()


@portal_bp.post("/sales/orders/<int:order_id>/messages/<int:message_id>/reply")
def sales_reply_message(order_id, message_id):
    u, err = _require_role(("sales", "admin"))
    if err: return err

    data = request.get_json(silent=True) or {}
    text = (data.get("message") or "").strip()
    if not text:
        return jsonify({"error": True, "message": "Reply cannot be empty"}), 400

    session = SessionLocal()
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err: return err

        parent = session.query(PortalMessage).filter_by(id=message_id, order_id=order.id).first()
        if not parent:
            return jsonify({"error": True, "message": "Message not found"}), 404

        reply = PortalMessage(order_id=order.id, sender_user_id=u["id"], message=text, status="replied", parent_message_id=parent.id)
        parent.status = "replied"
        session.add(reply)
        session.flush()
        log_portal_action(session, u, "sales_reply_message", entity_type="portal_message", entity_id=message_id, entity_label=f"order={order_id}")
        emit_portal_event(session, "message_created", "message", entity_id=reply.id, order_id=order.id, actor_user_id=u["id"], visibility="public", payload={"order_id": order.id, "message_id": reply.id})
        session.commit()
        return jsonify({"error": False, "message_id": reply.id})
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Admin endpoints
# ══════════════════════════════════════════════════

@portal_bp.get("/admin/users")
def admin_list_users():
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        rows = session.query(PortalUser).order_by(PortalUser.created_at.desc()).limit(200).all()
        return jsonify({"error": False, "users": [{
            "id": r.id, "email": r.email, "role": r.role,
            "display_name": r.display_name, "status": r.status,
            "assigned_sales_id": r.assigned_sales_id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]})
    finally:
        session.close()


@portal_bp.post("/admin/users")
def admin_create_user():
    u, err = _require_role(("admin",))
    if err: return err

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    role = (data.get("role") or "sales").strip().lower()
    display_name = (data.get("display_name") or "").strip()
    if not email or role not in ("admin", "sales", "customer"):
        return jsonify({"error": True, "message": "Valid email and role required"}), 400

    session = SessionLocal()
    try:
        existing = session.query(PortalUser).filter_by(email=email).first()
        if existing:
            return jsonify({"error": True, "message": "Email already in use"}), 409
        assigned_sales_id = None
        if role == "customer":
            if data.get("assigned_sales_id") in (None, ""):
                return jsonify({"error": True, "message": "Customer must be assigned to an active sales user"}), 400
            try:
                assigned_sales_id = int(data.get("assigned_sales_id"))
            except (TypeError, ValueError):
                return jsonify({"error": True, "message": "assigned_sales_id must be an integer"}), 400
            sales = session.query(PortalUser).filter_by(
                id=assigned_sales_id,
                role="sales",
                status="active",
            ).first()
            if not sales:
                return jsonify({"error": True, "message": "assigned_sales_id must be an active sales user"}), 400

        pw = secrets.token_hex(8)
        user = PortalUser(
            email=email, password_hash=generate_password_hash(pw), role=role,
            display_name=display_name or email.split("@")[0],
            must_change_password=True, created_by_user_id=u["id"],
            assigned_sales_id=assigned_sales_id,
        )
        session.add(user)
        session.flush()

        user_payload = _user_json(user)
        user_id = user.id

        log_portal_action(session, u, "portal_create_user", entity_type="portal_user", entity_id=user_id, entity_label=f"role={role}")
        session.commit()
        return jsonify({"error": False, "user": user_payload, "initial_password": pw, "user_id": user_id})
    finally:
        session.close()


@portal_bp.patch("/admin/users/<int:user_id>")
def admin_update_user(user_id):
    u, err = _require_role(("admin",))
    if err: return err

    data = request.get_json(silent=True) or {}
    session = SessionLocal()
    try:
        target = session.query(PortalUser).filter_by(id=user_id).first()
        if not target:
            return jsonify({"error": True, "message": "User not found"}), 404

        audit_action = None

        if "status" in data and data["status"] in ("active", "disabled"):
            target.status = data["status"]
            target.session_version += 1
            if data["status"] == "disabled":
                session.query(PortalSession).filter(PortalSession.user_id == user_id, PortalSession.revoked_at.is_(None)).update({"revoked_at": datetime.utcnow(), "revoked_reason": "admin_disabled_user"})
            audit_action = "portal_" + data["status"] + "_user"
        if "role" in data and data["role"] in ("admin", "sales", "customer"):
            target.role = data["role"]
        if "display_name" in data:
            target.display_name = data["display_name"] or None
        if "assigned_sales_id" in data:
            target.assigned_sales_id = data["assigned_sales_id"] or None
        if "reset_password" in data and data["reset_password"]:
            pw = secrets.token_hex(8)
            target.password_hash = generate_password_hash(pw)
            target.must_change_password = True
            target.session_version += 1
            target.password_changed_at = datetime.utcnow()
            session.query(PortalSession).filter(PortalSession.user_id == user_id, PortalSession.revoked_at.is_(None)).update({"revoked_at": datetime.utcnow(), "revoked_reason": "admin_reset_password"})
            target_id = target.id
            log_portal_action(session, u, "portal_reset_password", entity_type="portal_user", entity_id=user_id)
            session.commit()
            return jsonify({"error": False, "user_id": target_id, "initial_password": pw})

        target_id = target.id
        changed = []
        if audit_action:
            log_portal_action(session, u, audit_action, entity_type="portal_user", entity_id=user_id)
            changed.append(audit_action)
        if not audit_action and any(k in data for k in ("role", "display_name", "assigned_sales_id")):
            log_portal_action(session, u, "portal_update_user", entity_type="portal_user", entity_id=user_id, entity_label=",".join(k for k in ("role","display_name","assigned_sales_id") if k in data))
        session.commit()
        return jsonify({"error": False, "user_id": target_id})
    finally:
        session.close()


@portal_bp.get("/admin/orders")
def admin_list_orders():
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        sales_id = request.args.get("sales_id", type=int)
        customer_id = request.args.get("customer_id", type=int)
        status = request.args.get("status")
        stage = request.args.get("stage")
        q = request.args.get("q", "").strip()

        query = session.query(PortalOrder)
        if sales_id:
            query = query.filter(PortalOrder.sales_user_id == sales_id)
        if customer_id:
            query = query.filter(PortalOrder.customer_user_id == customer_id)
        if status:
            query = query.filter(PortalOrder.status == status)
        d_stat = request.args.get("display_status", "").strip()
        if stage:
            query = query.filter(PortalOrder.current_stage == stage)
        if q:
            query = query.filter(
                PortalOrder.title.ilike(f"%{q}%") | PortalOrder.order_no.ilike(f"%{q}%") | PortalOrder.po_number.ilike(f"%{q}%")
            )

        rows = query.order_by(PortalOrder.updated_at.desc()).limit(200).all()
        user_ids = set()
        for o in rows:
            if o.customer_user_id: user_ids.add(o.customer_user_id)
            if o.sales_user_id: user_ids.add(o.sales_user_id)
        users = {u2.id: u2 for u2 in session.query(PortalUser).filter(PortalUser.id.in_(user_ids)).all()} if user_ids else {}

        def _count(model, field, val):
            return session.query(model).filter(field == val).count()

        results = [{
            "id": o.id, "order_no": o.order_no, "title": o.title,
            "customer_user_id": o.customer_user_id, "sales_user_id": o.sales_user_id,
            "customer_name": (users.get(o.customer_user_id).display_name or users.get(o.customer_user_id).email) if o.customer_user_id in users else None,
            "display_status": _display_status(o), "manual_status": getattr(o, "manual_status", "normal") or "normal",
            "customer_email": users.get(o.customer_user_id).email if o.customer_user_id in users else None,
            "sales_name": (users.get(o.sales_user_id).display_name or users.get(o.sales_user_id).email) if o.sales_user_id in users else None,
            "sales_email": users.get(o.sales_user_id).email if o.sales_user_id in users else None,
            "current_stage": o.current_stage, "status": o.status,
            "estimated_delivery_date": o.estimated_delivery_date,
            "updates_count": _count(PortalOrderUpdate, PortalOrderUpdate.order_id, o.id),
            "media_count": _count(PortalOrderMedia, PortalOrderMedia.order_id, o.id),
            "messages_count": _count(PortalMessage, PortalMessage.order_id, o.id),
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        } for o in rows]

        if d_stat:
            results = [r for r in results if r.get("display_status") == d_stat]

        return jsonify({"error": False, "orders": results})
    finally:
        session.close()


@portal_bp.get("/admin/overview")
def admin_overview():
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        sales_count = session.query(PortalUser).filter_by(role="sales", status="active").count()
        customer_count = session.query(PortalUser).filter_by(role="customer", status="active").count()
        active_orders = session.query(PortalOrder).filter_by(status="active").count()
        today = datetime.utcnow().date()
        week_updates = session.query(PortalOrderUpdate).filter(PortalOrderUpdate.created_at >= today).count()
        return jsonify({"error": False, "overview": {
            "sales_count": sales_count, "customer_count": customer_count,
            "active_orders": active_orders, "updates_today": week_updates,
        }})
    finally:
        session.close()


@portal_bp.get("/admin/sales-reps")
def admin_sales_reps():
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        rows = session.query(PortalUser).filter_by(role="sales").order_by(PortalUser.created_at.desc()).all()
        result = []
        for s in rows:
            customer_count = session.query(PortalUser).filter_by(role="customer", assigned_sales_id=s.id).count()
            order_count = session.query(PortalOrder).filter_by(sales_user_id=s.id).count()
            last_log = session.query(PortalAuditLog).filter_by(actor_user_id=s.id).order_by(PortalAuditLog.created_at.desc()).first()
            result.append({
                "id": s.id, "email": s.email, "display_name": s.display_name, "status": s.status,
                "customer_count": customer_count, "order_count": order_count,
                "last_activity": last_log.created_at.isoformat() if last_log and last_log.created_at else None,
                "last_action": last_log.action if last_log else None,
            })
        return jsonify({"error": False, "sales_reps": result})
    finally:
        session.close()


@portal_bp.get("/admin/sales-reps/<int:sales_id>")
def admin_sales_rep_detail(sales_id):
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        rep = session.query(PortalUser).filter_by(id=sales_id, role="sales").first()
        if not rep:
            return jsonify({"error": True, "message": "Sales rep not found"}), 404
        customers = session.query(PortalUser).filter_by(role="customer", assigned_sales_id=sales_id).all()
        orders = session.query(PortalOrder).filter_by(sales_user_id=sales_id).order_by(PortalOrder.updated_at.desc()).limit(50).all()
        logs = list_portal_audit_logs(session, limit=50, actor_email=rep.email)
        return jsonify({"error": False, "rep": _user_json(rep),
            "customers": [_user_json(c) for c in customers],
            "orders": [{"id": o.id, "order_no": o.order_no, "title": o.title, "current_stage": o.current_stage, "status": o.status} for o in orders],
            "recent_logs": logs})
    finally:
        session.close()


@portal_bp.get("/admin/customers")
def admin_customers():
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        sales_id = request.args.get("sales_id", type=int)
        status = request.args.get("status", "active")
        q = request.args.get("q", "").strip()

        query = session.query(PortalUser).filter_by(role="customer")
        if status:
            query = query.filter(PortalUser.status == status)
        if sales_id:
            query = query.filter(PortalUser.assigned_sales_id == sales_id)
        if q:
            query = query.filter(
                PortalUser.display_name.ilike(f"%{q}%") | PortalUser.email.ilike(f"%{q}%")
            )

        rows = query.order_by(PortalUser.created_at.desc()).limit(200).all()
        sales_ids = {c.assigned_sales_id for c in rows if c.assigned_sales_id}
        sales_map = {s.id: s for s in session.query(PortalUser).filter(PortalUser.id.in_(sales_ids)).all()} if sales_ids else {}

        result = []
        for c in rows:
            order_count = session.query(PortalOrder).filter_by(customer_user_id=c.id).count()
            latest = session.query(PortalOrder).filter_by(customer_user_id=c.id).order_by(PortalOrder.updated_at.desc()).first()
            s2 = sales_map.get(c.assigned_sales_id)
            result.append({
                "id": c.id, "email": c.email, "display_name": c.display_name, "status": c.status,
                "sales_name": (s2.display_name or s2.email) if s2 else None,
                "assigned_sales_id": c.assigned_sales_id,
                "order_count": order_count,
                "latest_order_status": latest.status if latest else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            })
        return jsonify({"error": False, "customers": result})
    finally:
        session.close()


@portal_bp.get("/admin/customers/<int:customer_id>")
def admin_customer_detail(customer_id):
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        c = session.query(PortalUser).filter_by(id=customer_id, role="customer").first()
        if not c:
            return jsonify({"error": True, "message": "Customer not found"}), 404
        orders = session.query(PortalOrder).filter_by(customer_user_id=customer_id).order_by(PortalOrder.updated_at.desc()).all()
        s2 = session.query(PortalUser).filter_by(id=c.assigned_sales_id).first() if c.assigned_sales_id else None
        return jsonify({"error": False, "customer": _user_json(c),
            "sales_name": (s2.display_name or s2.email) if s2 else None,
            "orders": [{"id": o.id, "order_no": o.order_no, "title": o.title, "current_stage": o.current_stage, "status": o.status, "updated_at": o.updated_at.isoformat() if o.updated_at else None} for o in orders]})
    finally:
        session.close()


@portal_bp.get("/admin/orders/<int:order_id>/full")
def admin_order_full(order_id):
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        o = session.query(PortalOrder).filter_by(id=order_id).first()
        if not o:
            return jsonify({"error": True, "message": "Order not found"}), 404
        customer = session.query(PortalUser).filter_by(id=o.customer_user_id).first()
        sales = session.query(PortalUser).filter_by(id=o.sales_user_id).first()
        updates = session.query(PortalOrderUpdate).filter_by(order_id=order_id).order_by(PortalOrderUpdate.created_at.desc()).all()
        media = session.query(PortalOrderMedia).filter_by(order_id=order_id).order_by(PortalOrderMedia.created_at.desc()).all()
        msgs = session.query(PortalMessage).filter_by(order_id=order_id).order_by(PortalMessage.created_at.asc()).all()
        return jsonify({"error": False, "order": {
            "id": o.id, "order_no": o.order_no, "title": o.title, "po_number": o.po_number,
            "current_stage": o.current_stage, "status": o.status,
            "estimated_delivery_date": o.estimated_delivery_date,
            "shipping_tracking_no": o.shipping_tracking_no,
            "customer_visible_note": o.customer_visible_note, "internal_note": o.internal_note,
            "customer": _user_json(customer) if customer else None,
            "sales": _user_json(sales) if sales else None,
            "updates": [{"id": up.id, "stage_key": up.stage_key, "title": up.title, "message": up.message, "progress_percent": up.progress_percent, "created_at": up.created_at.isoformat() if up.created_at else None} for up in updates],
            "media": [{"id": m.id, "original_filename": m.original_filename, "filename": m.original_filename, "file_kind": m.file_kind or "image", "stage_key": m.stage_key, "mime_type": m.mime_type, "file_size": m.file_size, "caption": m.caption, "visible_to_customer": m.visible_to_customer, "created_at": m.created_at.isoformat() if m.created_at else None} for m in media],
            "messages": [{"id": msg.id, "sender_user_id": msg.sender_user_id, "message": msg.message, "status": msg.status, "parent_message_id": msg.parent_message_id, "created_at": msg.created_at.isoformat() if msg.created_at else None} for msg in msgs],
        }})
    finally:
        session.close()


@portal_bp.patch("/admin/orders/<int:order_id>/assign-sales")
def admin_assign_sales(order_id):
    u, err = _require_role(("admin",))
    if err: return err

    data = request.get_json(silent=True) or {}
    sales_id_raw = data.get("sales_user_id")
    if not sales_id_raw:
        return jsonify({"error": True, "message": "sales_user_id is required"}), 400
    try:
        sales_id = int(sales_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": True, "message": "sales_user_id must be an integer"}), 400

    session = SessionLocal()
    try:
        order = session.query(PortalOrder).filter_by(id=order_id).first()
        if not order:
            return jsonify({"error": True, "message": "Order not found"}), 404
        target = session.query(PortalUser).filter_by(id=sales_id, role="sales", status="active").first()
        if not target:
            return jsonify({"error": True, "message": "Target user must be an active sales user"}), 400
        old_sales_id = order.sales_user_id
        order.sales_user_id = sales_id
        order_id_val = order.id
        log_portal_action(
            session, u, "portal_assign_sales",
            entity_type="portal_order", entity_id=order_id,
            entity_label=f"sales={sales_id}",
            before={"sales_user_id": old_sales_id},
            after={"sales_user_id": sales_id},
        )
        session.commit()
        return jsonify({"error": False, "order_id": order_id_val})
    finally:
        session.close()


@portal_bp.get("/admin/audit-logs")
def admin_audit_logs():
    u, err = _require_role(("admin",))
    if err: return err

    session = SessionLocal()
    try:
        logs = list_portal_audit_logs(session, limit=200)
        return jsonify({"error": False, "logs": logs})
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Event stream (SSE)
# ══════════════════════════════════════════════════

@portal_bp.get("/events")
def portal_events_stream():
    from flask import Response

    u, err = _current_user()
    if err:
        return Response("Unauthorized", status=401)

    last_id = request.headers.get("Last-Event-ID") or request.args.get("after_id") or 0
    logger.info("portal_sse_open user_id=%s role=%s after_id=%s", u.get("id"), u.get("role"), last_id)

    def stream():
        current_id = int(last_id or 0)
        while True:
            session = SessionLocal()
            try:
                rows = query_visible_events(session, u, after_id=current_id, limit=50)
                for evt in rows:
                    current_id = evt["id"]
                    data = json.dumps(evt, ensure_ascii=False)
                    yield f"id: {current_id}\nevent: {evt['event_type']}\ndata: {data}\n\n"
            except Exception:
                logger.exception("portal_sse_loop_failed user_id=%s role=%s after_id=%s", u.get("id"), u.get("role"), current_id)
            finally:
                try: session.close()
                except: pass
            hb = json.dumps({"ts": datetime.utcnow().isoformat()})
            yield f"event: heartbeat\ndata: {hb}\n\n"
            import time; time.sleep(3)

    return Response(stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


# ══════════════════════════════════════════════════
# Snapshot — lightweight state for reconciliation
# ══════════════════════════════════════════════════

@portal_bp.get("/snapshot")
def portal_snapshot():
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        if u["role"] == "customer":
            orders = session.query(PortalOrder).filter_by(customer_user_id=u["id"]).order_by(PortalOrder.updated_at.desc()).limit(50).all()
            oids = [o.id for o in orders]
            latest = session.query(PortalEvent).filter(PortalEvent.order_id.in_(oids), PortalEvent.visibility == "public").order_by(PortalEvent.id.desc()).first()
        elif u["role"] == "sales":
            orders = session.query(PortalOrder).filter_by(sales_user_id=u["id"]).order_by(PortalOrder.updated_at.desc()).limit(100).all()
            oids = [o.id for o in orders]
            latest = session.query(PortalEvent).filter(PortalEvent.order_id.in_(oids), PortalEvent.visibility.in_(["public", "internal"])).order_by(PortalEvent.id.desc()).first()
        else:
            orders = session.query(PortalOrder).order_by(PortalOrder.updated_at.desc()).limit(300).all()
            latest = session.query(PortalEvent).order_by(PortalEvent.id.desc()).first()
        latest_event_id = latest.id if latest else 0

        result = []
        for o in orders:
            updates_q = session.query(PortalOrderUpdate).filter_by(order_id=o.id)
            media_q = session.query(PortalOrderMedia).filter_by(order_id=o.id)
            if u["role"] == "customer":
                updates_q = updates_q.filter(PortalOrderUpdate.visible_to_customer == True)
                media_q = media_q.filter(PortalOrderMedia.visible_to_customer == True)
            result.append({
                "id": o.id, "order_no": o.order_no, "title": o.title,
                "status": o.status, "current_stage": o.current_stage,
                "estimated_delivery_date": o.estimated_delivery_date,
                "updated_at": o.updated_at.isoformat() if o.updated_at else None,
                "counts": {
                    "updates": updates_q.count(),
                    "messages": session.query(PortalMessage).filter_by(order_id=o.id).count(),
                    "media": media_q.count(),
                }
            })
        return jsonify({"error": False, "server_time": datetime.utcnow().isoformat(), "latest_event_id": latest_event_id, "orders": result})
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Media ticket — preview/download
# ══════════════════════════════════════════════════

@portal_bp.post("/orders/<int:order_id>/media/<int:media_id>/ticket")
def portal_media_ticket(order_id, media_id):
    u, err = _require_authenticated()
    if err: return err

    session = SessionLocal()
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err: return err

        media = session.query(PortalOrderMedia).filter_by(id=media_id, order_id=order.id).first()
        if not media:
            return jsonify({"error": True, "message": "Not found"}), 404
        if u["role"] == "customer" and not media.visible_to_customer:
            return jsonify({"error": True, "message": "Not found"}), 404

        serializer = _media_ticket_serializer()
        token = serializer.dumps({"o": order_id, "m": media_id, "u": u["id"], "r": u["role"]})
        url = url_for("portal.portal_media_serve", token=token, _external=True)
        return jsonify({"error": False, "url": url, "expires_in": 600})
    finally:
        session.close()


@portal_bp.get("/media-ticket/<token>")
def portal_media_serve(token):
    from itsdangerous import BadData, SignatureExpired
    from flask import send_file

    serializer = _media_ticket_serializer()
    try:
        payload = serializer.loads(token, max_age=600)
    except SignatureExpired:
        return jsonify({"error": True, "message": "Ticket expired"}), 410
    except BadData:
        return jsonify({"error": True, "message": "Invalid ticket"}), 400

    session = SessionLocal()
    try:
        media = session.query(PortalOrderMedia).filter_by(id=payload["m"], order_id=payload["o"]).first()
        if not media or not media.stored_filename:
            return jsonify({"error": True, "message": "Not found"}), 404

        user = session.query(PortalUser).filter_by(id=payload["u"]).first()
        if not user or user.status != "active":
            return jsonify({"error": True, "message": "Unauthorized"}), 401
        if payload["r"] == "customer" and not media.visible_to_customer:
            return jsonify({"error": True, "message": "Not found"}), 404

        file_path = MEDIA_DIR / media.stored_filename
        if not file_path.exists():
            return jsonify({"error": True, "message": "File not found"}), 404

        attachment = request.args.get("download") == "1"
        return send_file(str(file_path), mimetype=media.mime_type or "application/octet-stream", conditional=True, as_attachment=attachment, download_name=media.original_filename)
    finally:
        session.close()


# ══════════════════════════════════════════════════
# Complaint
# ══════════════════════════════════════════════════

@portal_bp.post("/orders/<int:order_id>/complaints")
def portal_order_complaint(order_id):
    u, err = _require_authenticated()
    if err: return err

    data = request.get_json(silent=True) or {}
    text = (data.get("message") or "").strip()
    if not text:
        return jsonify({"error": True, "message": "Message is required"}), 400

    session = SessionLocal()
    try:
        o = session.query(PortalOrder).filter_by(id=order_id).first()
        if not o:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "customer" and o.customer_user_id != u["id"]:
            return jsonify({"error": True, "message": "Order not found"}), 404
        if u["role"] == "sales" and o.sales_user_id != u["id"] and u["role"] != "admin":
            return jsonify({"error": True, "message": "Forbidden"}), 403
        if u["role"] == "customer" and o.current_stage != "received":
            return jsonify({"error": True, "message": "Complaints can only be opened after the order is received"}), 400

        msg = PortalMessage(order_id=order_id, sender_user_id=u["id"], message=text, status="open")
        session.add(msg)
        session.flush()
        o.manual_status = "complaint"
        if not o.complaint_status:
            o.complaint_status = "open"
        if not o.complaint_opened_at:
            o.complaint_opened_at = datetime.utcnow()
        emit_portal_event(session, "message_created", "message", entity_id=msg.id, order_id=order_id, actor_user_id=u["id"], visibility="public", payload={"order_id": order_id, "message_id": msg.id})
        emit_portal_event(session, "complaint_changed", "order", entity_id=order_id, order_id=order_id, actor_user_id=u["id"], visibility="public", payload={"order_id": order_id, "manual_status": "complaint"})
        session.commit()
        return jsonify({"error": False, "message_id": msg.id, "manual_status": o.manual_status, "display_status": _display_status(o)})
    finally:
        session.close()
