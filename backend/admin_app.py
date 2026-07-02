"""Admin Console — separate Flask app on port 5010, localhost-only."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session as flask_session, redirect, url_for, abort
from werkzeug.security import check_password_hash, generate_password_hash

from database import SessionLocal, init_db
from models import AdminUser, Inquiry
from services.settings import get_all_settings, get_setting, update_setting, log_admin_action, get_audit_logs

BACKEND_ROOT = Path(__file__).resolve().parent
TEMPLATES = BACKEND_ROOT / "templates" / "admin"
STATIC = BACKEND_ROOT / "static" / "admin"

app = Flask(__name__, template_folder=str(TEMPLATES), static_folder=str(STATIC), static_url_path="/admin/static")
app.secret_key = os.environ.get("ADMIN_SECRET_KEY", "change-me-in-production")

# ── Localhost guard ────────────────────────────

@app.before_request
def localhost_guard():
    if request.remote_addr not in ("127.0.0.1", "::1", "localhost"):
        abort(403)


# ── Auth helpers ────────────────────────────────

def admin_required():
    if not flask_session.get("admin_user"):
        return redirect(url_for("login_page"))
    return None


def audit(action: str, target_type: str = "", target_key: str = "", old_val: str = "", new_val: str = ""):
    log_admin_action(
        admin_username=flask_session.get("admin_user", "unknown"),
        action=action, target_type=target_type, target_key=target_key,
        client_ip=request.remote_addr or "", user_agent=request.headers.get("User-Agent", ""),
    )


# ── Pages ───────────────────────────────────────

@app.get("/admin")
@app.get("/admin/dashboard")
def dashboard_page():
    r = admin_required()
    if r: return r
    session = SessionLocal()
    try:
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = session.query(Inquiry).filter(Inquiry.created_at >= today).count()
        week_count = session.query(Inquiry).filter(Inquiry.created_at >= today - __import__("datetime").timedelta(days=7)).count()
        recent = session.query(Inquiry).order_by(Inquiry.created_at.desc()).limit(10).all()
    finally:
        session.close()

    return render_template("dashboard.html",
        admin_user=flask_session.get("admin_user"),
        today_count=today_count, week_count=week_count or 1,
        recent=[{
            "part_name": i.part_name or i.stp_filename or "-",
            "email": i.customer_email or "-",
            "total": i.total_display or "-",
            "material": i.material_name or "-",
            "created_at": i.created_at.strftime("%Y-%m-%d %H:%M") if i.created_at else "-"
        } for i in recent] if recent else [])


@app.get("/admin/login")
def login_page():
    return render_template("login.html")


@app.post("/admin/login")
def login_action():
    data = request.form
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "")

    session = SessionLocal()
    try:
        user = session.query(AdminUser).filter_by(username=username).first()
        if not user:
            # Auto-create default admin if table is empty
            count = session.query(AdminUser).count()
            if count == 0 and username:
                default_pw = "admin123"
                session.add(AdminUser(username=username, password_hash=generate_password_hash(default_pw)))
                session.commit()
                user = session.query(AdminUser).filter_by(username=username).first()

        if user and check_password_hash(user.password_hash, password):
            flask_session["admin_user"] = user.username
            audit("login")
            return redirect(url_for("dashboard_page"))

        audit("login_failed", target_key=username)
        return render_template("login.html", error="Invalid credentials")
    finally:
        session.close()


@app.get("/admin/logout")
def logout():
    audit("logout")
    flask_session.clear()
    return redirect(url_for("login_page"))


# ── API ─────────────────────────────────────────

@app.get("/api/admin/inquiries")
def admin_inquiries():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401

    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 25))
    q = request.args.get("q", "").strip()
    date_from = request.args.get("date_from", "")
    date_to = request.args.get("date_to", "")

    session = SessionLocal()
    try:
        query = session.query(Inquiry)
        if q:
            like = f"%{q}%"
            query = query.filter(
                (Inquiry.customer_email.ilike(like)) |
                (Inquiry.stp_filename.ilike(like)) |
                (Inquiry.part_name.ilike(like)) |
                (Inquiry.material_name.ilike(like))
            )
        if date_from:
            query = query.filter(Inquiry.created_at >= date_from)
        if date_to:
            query = query.filter(Inquiry.created_at <= date_to + " 23:59:59")
        total = query.count()
        rows = query.order_by(Inquiry.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

        items = []
        for i in rows:
            items.append({
                "record_id": i.id,
                "part_name": i.part_name or i.stp_filename or "-",
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "customer_name": i.customer_name or "-",
                "customer_email": i.customer_email or "-",
                "quantity": i.quantity,
                "material_name": i.material_name or "-",
                "total_display": i.total_display or "-",
                "currency": i.currency or "-",
                "batch_item_index": i.batch_item_index,
                "batch_item_count": i.batch_item_count,
                "stp_filename": i.stp_filename,
                "client_ip": i.client_ip,
            })
        return jsonify({"items": items, "total": total, "page": page, "page_size": page_size})
    finally:
        session.close()


@app.get("/api/admin/inquiries/<int:record_id>")
def admin_inquiry_detail(record_id):
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401

    session = SessionLocal()
    try:
        row = session.query(Inquiry).filter_by(id=record_id).first()
        if not row:
            return jsonify({"error": "not_found"}), 404

        import json as _json
        return jsonify({
            "id": row.id,
            "type": row.type,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "part_name": row.part_name or row.stp_filename or "-",
            "customer_name": row.customer_name,
            "customer_email": row.customer_email,
            "quantity": row.quantity,
            "material_name": row.material_name,
            "total_display": row.total_display,
            "currency": row.currency,
            "tolerance_grade": row.tolerance_grade,
            "volume_mm3": row.volume_mm3,
            "weight_kg": row.weight_kg,
            "batch_id": row.batch_id,
            "batch_item_index": row.batch_item_index,
            "batch_item_count": row.batch_item_count,
            "stp_filename": row.stp_filename,
            "client_ip": row.client_ip,
            "input_params": _json.loads(row.input_params) if row.input_params else None,
            "result": _json.loads(row.result) if row.result else None,
        })
    finally:
        session.close()


@app.get("/api/admin/settings")
def admin_settings():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401

    scope = request.args.get("scope", "")
    rows = get_all_settings(scope=scope or None)
    return jsonify({"settings": rows})


@app.put("/api/admin/settings")
def admin_settings_update():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    scope = data.get("scope", "global")
    key = data.get("key", "")
    value = data.get("value", "")

    ok = update_setting(
        scope=scope, key=key, value=value,
        admin_username=flask_session.get("admin_user", ""),
        client_ip=request.remote_addr or "",
        user_agent=request.headers.get("User-Agent", ""),
    )
    return jsonify({"ok": ok})


@app.get("/api/admin/audit-logs")
def admin_audit_logs():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401
    return jsonify({"logs": get_audit_logs(limit=200)})


@app.get("/api/admin/system/health")
def admin_system_health():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401

    import os
    db_path = BACKEND_ROOT / "data" / "daiyujin.db"
    upload_dir = BACKEND_ROOT / "uploads"
    thumb_dir = BACKEND_ROOT / "static" / "thumbnails"
    stl_dir = BACKEND_ROOT / "static" / "stl"

    session = SessionLocal()
    try:
        total_inquiries = session.query(Inquiry).count()
        latest = session.query(Inquiry).order_by(Inquiry.created_at.desc()).first()
    finally:
        session.close()

    def dir_info(path: Path):
        if not path.exists(): return {"files": 0, "size_mb": 0}
        files = list(path.iterdir())
        size = sum(f.stat().st_size for f in files if f.is_file())
        return {"files": len(files), "size_mb": round(size / 1024 / 1024, 2)}

    return jsonify({
        "db_path": str(db_path),
        "db_size_mb": round(db_path.stat().st_size / 1024 / 1024, 2) if db_path.exists() else 0,
        "total_inquiries": total_inquiries,
        "latest_inquiry": latest.created_at.isoformat() if latest and latest.created_at else "never",
        "uploads": dir_info(upload_dir),
        "thumbnails": dir_info(thumb_dir),
        "stl_files": dir_info(stl_dir),
        "api_status": "running",
    })


@app.get("/api/admin/inquiries/export.csv")
def admin_inquiries_export():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401

    import csv, io
    session = SessionLocal()
    try:
        rows = session.query(Inquiry).order_by(Inquiry.created_at.desc()).limit(5000).all()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Time", "Part", "Customer", "Email", "Qty", "Material", "Estimate", "Currency", "Batch", "File", "IP"])
        for i in rows:
            writer.writerow([
                i.id,
                i.created_at.isoformat() if i.created_at else "",
                i.part_name or i.stp_filename or "",
                i.customer_name or "",
                i.customer_email or "",
                i.quantity or "",
                i.material_name or "",
                i.total_display or "",
                i.currency or "",
                f"{i.batch_item_index}/{i.batch_item_count}" if i.batch_item_index else "",
                i.stp_filename or "",
                i.client_ip or "",
            ])
        csv_data = output.getvalue()
        audit("export_csv", target_key=f"{len(rows)} rows")
        return csv_data, 200, {"Content-Type": "text/csv", "Content-Disposition": "attachment; filename=inquiries_export.csv"}
    finally:
        session.close()


# ── Init ────────────────────────────────────────

def _ensure_admin_user():
    session = SessionLocal()
    try:
        if session.query(AdminUser).count() == 0:
            session.add(AdminUser(username="admin", password_hash=generate_password_hash("admin123")))
            session.commit()
            print("Admin user created: admin / admin123")
    finally:
        session.close()


if __name__ == "__main__":
    init_db()
    _ensure_admin_user()
    print("Admin Console: http://127.0.0.1:5010/admin")
    app.run(host="127.0.0.1", port=5010, debug=False, use_reloader=False)
