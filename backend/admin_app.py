"""Admin Console — separate Flask app on port 5010, localhost-only."""
from __future__ import annotations

import json as _json
import os
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session as flask_session, redirect, url_for, abort
from werkzeug.security import check_password_hash, generate_password_hash

from database import SessionLocal, init_db
from models import AdminUser, Inquiry
from services.settings import get_all_settings, get_setting, update_setting, log_admin_action, get_audit_logs

import time
from collections import defaultdict

BACKEND_ROOT = Path(__file__).resolve().parent
TEMPLATES = BACKEND_ROOT / "templates" / "admin"
STATIC = BACKEND_ROOT / "static" / "admin"

app = Flask(__name__, template_folder=str(TEMPLATES), static_folder=str(STATIC), static_url_path="/admin/static")
app.secret_key = os.environ.get("ADMIN_SECRET_KEY", "change-me-in-production")

# Login rate limiting
_login_attempts: dict[str, list[float]] = defaultdict(list)

# ── Material display helper ────────────────────

CATEGORY_CN = {
    "aluminum_alloy": "铝合金",
    "carbon_alloy_steel": "碳钢 / 合金钢",
    "engineering_plastic": "工程塑料",
    "high_performance_plastic": "高性能塑料",
    "stainless_steel": "不锈钢",
    "tool_steel": "工具钢",
}


def _admin_material_display(inquiry: Inquiry) -> str:
    """Return Chinese-readable material display from JSON snapshot or DB field."""
    def from_snapshot(raw: str | None) -> str | None:
        if not raw:
            return None
        try:
            data = _json.loads(raw)
        except Exception:
            return None
        selections = data.get("selections") or {}
        material = selections.get("material") or {}
        mat_name = str(material.get("name") or "").strip()
        mat_id = str(material.get("id") or "").strip()
        cat_id = str(selections.get("material_category") or "").strip()
        cat_name = CATEGORY_CN.get(cat_id, cat_id)
        if mat_name and cat_name:
            return f"{cat_name} / {mat_name}"
        if mat_name:
            return mat_name
        if mat_id and cat_name:
            return f"{cat_name} / {mat_id}"
        return None

    display = from_snapshot(inquiry.result) or from_snapshot(inquiry.input_params)
    if display:
        return display
    raw = (inquiry.material_name or "").strip()
    if raw and not raw.startswith("mp_"):
        return raw
    return f"未知材料（{raw}）" if raw else "-"


def _admin_inquiry_search_blob(inquiry: Inquiry) -> str:
    """Build searchable text blob for inquiry filtering."""
    parts = [
        inquiry.customer_name or "",
        inquiry.customer_email or "",
        inquiry.stp_filename or "",
        inquiry.part_name or "",
        inquiry.material_name or "",
        _admin_material_display(inquiry),
        inquiry.total_display or "",
    ]
    return " ".join(parts).lower()

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
        # Use local time for today/week boundaries
        from datetime import timedelta
        now_local = datetime.now()
        today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = session.query(Inquiry).filter(Inquiry.created_at >= today_start).count()
        week_count = session.query(Inquiry).filter(Inquiry.created_at >= today_start - timedelta(days=7)).count()
        recent = session.query(Inquiry).order_by(Inquiry.created_at.desc()).limit(10).all()
    finally:
        session.close()

    def _safe_total(i):
        raw = (i.total_display or "").strip()
        low = raw.lower()
        if not raw or "nan" in low or "inf" in low:
            return "报价异常"
        return raw

    return render_template("dashboard.html",
        admin_user=flask_session.get("admin_user"),
        today_count=today_count, week_count=week_count,
        recent=[{
            "part_name": i.part_name or i.stp_filename or "-",
            "email": i.customer_email or "-",
            "total": _safe_total(i),
            "material": _admin_material_display(i),
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
    ip = request.remote_addr or ""

    # Rate limiting: 5 failed attempts = 5-minute cooldown
    now = time.time()
    _login_attempts[ip] = [t for t in _login_attempts.get(ip, []) if now - t < 300]
    if len(_login_attempts[ip]) >= 5:
        remaining = int(300 - (now - _login_attempts[ip][0]))
        return render_template("login.html", error=f"登录失败次数过多，请 {remaining} 秒后再试。")

    session = SessionLocal()
    try:
        user = session.query(AdminUser).filter_by(username=username).first()
        if not user:
            count = session.query(AdminUser).count()
            if count == 0 and username:
                default_pw = "admin123"
                session.add(AdminUser(username=username, password_hash=generate_password_hash(default_pw)))
                session.commit()
                user = session.query(AdminUser).filter_by(username=username).first()

        if user and check_password_hash(user.password_hash, password):
            flask_session["admin_user"] = user.username
            _login_attempts.pop(ip, None)
            audit("login")
            return redirect(url_for("dashboard_page"))

        _login_attempts[ip].append(now)
        audit("login_failed", target_key=username)
        attempts_left = 5 - len(_login_attempts[ip])
        return render_template("login.html", error=f"用户名或密码错误，还可尝试 {attempts_left} 次。")
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
        if date_from:
            query = query.filter(Inquiry.created_at >= date_from)
        if date_to:
            query = query.filter(Inquiry.created_at <= date_to + " 23:59:59")

        # Date-filtered candidate set
        candidates = query.order_by(Inquiry.created_at.desc()).all()

        # Apply text search in Python layer (includes material display name)
        if q:
            q_lower = q.lower()
            candidates = [i for i in candidates if q_lower in _admin_inquiry_search_blob(i)]

        total = len(candidates)
        start = (page - 1) * page_size
        page_items = candidates[start:start + page_size]

        items = []
        for i in page_items:
            items.append({
                "record_id": i.record_id,
                "part_name": i.part_name or i.stp_filename or "-",
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "customer_name": i.customer_name or "-",
                "customer_email": i.customer_email or "-",
                "quantity": i.quantity,
                "material_name": _admin_material_display(i),
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
        row = session.query(Inquiry).filter_by(record_id=record_id).first()
        if not row:
            return jsonify({"error": "not_found"}), 404

        import json as _json
        return jsonify({
            "id": row.record_id,
            
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "part_name": row.part_name or row.stp_filename or "-",
            "customer_name": row.customer_name,
            "customer_email": row.customer_email,
            "quantity": row.quantity,
            "material_name": _admin_material_display(row),
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


@app.put("/api/admin/password")
def admin_change_password():
    r = admin_required()
    if r: return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    current = data.get("current", "")
    new_password = data.get("new", "")
    username = flask_session.get("admin_user", "")
    if len(new_password) < 6:
        return jsonify({"ok": False, "error": "新密码至少需要 6 个字符"})
    session = SessionLocal()
    try:
        user = session.query(AdminUser).filter_by(username=username).first()
        if not user or not check_password_hash(user.password_hash, current):
            return jsonify({"ok": False, "error": "当前密码不正确"})
        user.password_hash = generate_password_hash(new_password)
        session.commit()
        audit("change_password")
        return jsonify({"ok": True})
    finally:
        session.close()


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
        # UTF-8 BOM for Excel Chinese compatibility
        output.write("\ufeff")
        writer = csv.writer(output)
        writer.writerow(["ID", "Time", "Part", "Customer", "Email", "Qty", "Material", "Estimate", "Currency", "Batch", "File", "IP"])
        for i in rows:
            writer.writerow([
                i.record_id,
                i.created_at.isoformat() if i.created_at else "",
                i.part_name or i.stp_filename or "",
                i.customer_name or "",
                i.customer_email or "",
                i.quantity or "",
                _admin_material_display(i),
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
