"""Order Portal — auth + orders API."""
from __future__ import annotations

import hashlib
import random
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from database import SessionLocal
from services.portal_audit import log_portal_action, list_portal_audit_logs
from models import PortalSession, PortalUser, PortalOrder, PortalOrderUpdate, PortalOrderMedia, PortalMessage, PortalAuditLog

from pathlib import Path

MEDIA_DIR = Path(__file__).resolve().parents[1] / "private" / "order_media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "thumbs").mkdir(exist_ok=True)

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024

portal_bp = Blueprint("portal", __name__, url_prefix="/api/portal")

SESSION_HOURS = 24
_login_attempts: dict[str, list[float]] = defaultdict(list)

VALID_STAGES = {"order_confirmed", "material_purchasing", "material_ready", "machining",
    "in_process_qc", "surface_treatment", "final_inspection", "packing", "shipped", "delivered", "on_hold"}
VALID_STATUSES = {"active", "on_hold", "shipped", "delivered", "cancelled"}


def _validate_progress(val):
    if val is None:
        return None
    try:
        n = int(val)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, n))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


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

        s.last_seen_at = datetime.utcnow()
        u = session.query(PortalUser).filter_by(id=s.user_id).first()
        if not u or u.status != "active":
            return None, (jsonify({"error": True, "message": "Account is disabled or not found"}), 401)
        session.commit()
        return {"id": u.id, "email": u.email, "role": u.role, "display_name": u.display_name, "must_change_password": u.must_change_password}, None
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


def _order_no():
    """Generate unique order number with retry."""
    for _ in range(5):
        no = f"DYJ-{datetime.utcnow().strftime('%Y%m%d')}-{random.randint(1000,9999)}"
        session = SessionLocal()
        try:
            if not session.query(PortalOrder).filter_by(order_no=no).first():
                return no
        finally:
            session.close()
    return f"DYJ-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{random.randint(0,99):02d}"


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

    ip = request.remote_addr or ""
    now = time.time()
    _login_attempts[ip] = [t for t in _login_attempts.get(ip, []) if now - t < 300]
    if len(_login_attempts[ip]) >= 8:
        return jsonify({"error": True, "message": "Too many attempts. Please try again later."}), 429

    session = SessionLocal()
    try:
        u = session.query(PortalUser).filter_by(email=email).first()
        if not u or not check_password_hash(u.password_hash, password):
            _login_attempts[ip].append(now)
            return jsonify({"error": True, "message": "Invalid credentials"}), 401
        if u.status != "active":
            return jsonify({"error": True, "message": "Account is disabled"}), 401

        _login_attempts.pop(ip, None)
        token = secrets.token_hex(32)
        session.add(PortalSession(
            user_id=u.id, token_hash=_hash_token(token),
            expires_at=datetime.utcnow() + timedelta(hours=SESSION_HOURS),
            client_ip=ip, user_agent=request.headers.get("User-Agent"),
        ))
        u.last_login_at = datetime.utcnow()
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
    return jsonify({"error": False, "user": u})


@portal_bp.post("/auth/change-password")
def portal_change_password():
    u, err = _current_user()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    current = data.get("current", "")
    new_pw = data.get("new", "")
    if len(new_pw) < 10:
        return jsonify({"error": True, "message": "New password must be at least 10 characters"}), 400

    session = SessionLocal()
    try:
        ou = session.query(PortalUser).filter_by(id=u["id"]).first()
        if not ou or not check_password_hash(ou.password_hash, current):
            return jsonify({"error": True, "message": "Current password is incorrect"}), 401
        ou.password_hash = generate_password_hash(new_pw)
        ou.must_change_password = False
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
        q = session.query(PortalOrder)
        if u["role"] == "customer":
            q = q.filter(PortalOrder.customer_user_id == u["id"])
        elif u["role"] == "sales":
            q = q.filter(PortalOrder.sales_user_id == u["id"])
        rows = q.order_by(PortalOrder.updated_at.desc()).limit(100).all()
        return jsonify({"error": False, "orders": [{
            "id": o.id, "order_no": o.order_no, "title": o.title,
            "current_stage": o.current_stage, "status": o.status,
            "estimated_delivery_date": o.estimated_delivery_date,
            "customer_visible_note": o.customer_visible_note,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        } for o in rows]})
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
        return jsonify({"error": False, "order": {
            "id": o.id, "order_no": o.order_no, "title": o.title,
            "po_number": o.po_number, "current_stage": o.current_stage,
            "status": o.status, "estimated_delivery_date": o.estimated_delivery_date,
            "shipping_tracking_no": o.shipping_tracking_no,
            "customer_visible_note": o.customer_visible_note,
            "customer": {"email": cu.email, "display_name": cu.display_name} if cu else None,
            "sales": {"email": su.email, "display_name": su.display_name} if su else None,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        }})
    finally:
        session.close()


@portal_bp.post("/sales/orders")
def sales_create_order():
    u, err = _require_role(("sales", "admin"))
    if err: return err

    data = request.get_json(silent=True) or {}
    customer_email = (data.get("customer_email") or "").strip().lower()
    title = (data.get("title") or "").strip()
    stage = (data.get("current_stage") or "order_confirmed").strip().lower()

    if not customer_email or not title:
        return jsonify({"error": True, "message": "customer_email and title are required"}), 400
    if stage not in VALID_STAGES:
        return jsonify({"error": True, "message": f"Invalid stage: {stage}"}), 400

    session = SessionLocal()
    try:
        customer = session.query(PortalUser).filter_by(email=customer_email, role="customer").first()
        if not customer:
            return jsonify({"error": True, "message": "Customer not found. Create the customer first."}), 404
        if u["role"] != "admin" and customer.assigned_sales_id != u["id"]:
            return jsonify({"error": True, "message": "Customer is assigned to another sales representative"}), 403

        o = PortalOrder(
            order_no=_order_no(), customer_user_id=customer.id, sales_user_id=u["id"],
            title=title, po_number=data.get("po_number") or None, current_stage=stage,
            estimated_delivery_date=data.get("estimated_delivery_date") or None,
            customer_visible_note=data.get("customer_visible_note") or None,
            created_by_user_id=u["id"],
        )
        session.add(o)
        log_portal_action(session, u, "sales_create_order", entity_type="portal_order", entity_label=f"#{o.order_no} {title}")
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
        log_portal_action(session, u, "sales_add_order_update", entity_type="portal_order", entity_id=order_id, entity_label=f"stage={sk or 'note'}")
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
        if "status" in data:
            s = data["status"]
            if s and s not in VALID_STATUSES:
                return jsonify({"error": True, "message": f"Invalid status: {s}"}), 400
            o.status = s
        if "estimated_delivery_date" in data: o.estimated_delivery_date = data["estimated_delivery_date"] or None
        if "shipping_tracking_no" in data: o.shipping_tracking_no = data["shipping_tracking_no"] or None
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

        log_portal_action(session, u, "sales_update_order_stage", entity_type="portal_order", entity_id=order_id, entity_label=f"stage={data.get('current_stage','')} status={data.get('status','')}".strip())
        session.commit()  # single commit for order + timeline
        return jsonify({"error": False, "message": "Order updated", "order_id": o.id})
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
    if ext not in ALLOWED_EXT:
        return jsonify({"error": True, "message": "Only jpg/png/webp images allowed"}), 400

    data = file.read()
    if len(data) > MAX_FILE_SIZE:
        return jsonify({"error": True, "message": "File too large (max 10MB)"}), 400

    session = SessionLocal()
    path = None
    try:
        order, err = _load_order_for_user(session, u, order_id)
        if err:
            return err

        count = session.query(PortalOrderMedia).filter_by(order_id=order.id).count()
        if count >= 100:
            return jsonify({"error": True, "message": "Maximum 100 images per order"}), 400

        stored = f"{secrets.token_hex(16)}{ext}"
        path = MEDIA_DIR / stored
        path.write_bytes(data)

        visible_raw = (request.form.get("visible_to_customer", "1") or "1").strip().lower()
        visible = visible_raw not in {"0", "false", "no", "off"}

        media = PortalOrderMedia(
            order_id=order.id,
            update_id=request.form.get("update_id") or None,
            uploaded_by_user_id=u["id"],
            stored_filename=stored,
            original_filename=Path(file.filename).name,
            mime_type=file.content_type or "image/jpeg",
            file_size=len(data),
            caption=(request.form.get("caption") or "").strip() or None,
            visible_to_customer=visible,
        )
        session.add(media)
        log_portal_action(session, u, "sales_upload_media", entity_type="portal_order_media", entity_id=order_id, entity_label=f"{stored}")
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
        log_portal_action(session, u, "sales_reply_message", entity_type="portal_message", entity_id=message_id, entity_label=f"order={order_id}")
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
        if role == "customer" and data.get("assigned_sales_id") not in (None, ""):
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
        if stage:
            query = query.filter(PortalOrder.current_stage == stage)
        if q:
            query = query.filter(
                PortalOrder.title.ilike(f"%{q}%") | PortalOrder.order_no.ilike(f"%{q}%")
            )

        rows = query.order_by(PortalOrder.updated_at.desc()).limit(200).all()
        user_ids = set()
        for o in rows:
            if o.customer_user_id: user_ids.add(o.customer_user_id)
            if o.sales_user_id: user_ids.add(o.sales_user_id)
        users = {u2.id: u2 for u2 in session.query(PortalUser).filter(PortalUser.id.in_(user_ids)).all()} if user_ids else {}

        def _count(model, field, val):
            return session.query(model).filter(field == val).count()

        return jsonify({"error": False, "orders": [{
            "id": o.id, "order_no": o.order_no, "title": o.title,
            "customer_user_id": o.customer_user_id, "sales_user_id": o.sales_user_id,
            "customer_name": (users.get(o.customer_user_id).display_name or users.get(o.customer_user_id).email) if o.customer_user_id in users else None,
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
        } for o in rows]})
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
            "media": [{"id": m.id, "original_filename": m.original_filename, "mime_type": m.mime_type, "caption": m.caption, "visible_to_customer": m.visible_to_customer, "created_at": m.created_at.isoformat() if m.created_at else None} for m in media],
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
