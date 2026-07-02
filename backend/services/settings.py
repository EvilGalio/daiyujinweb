"""App settings service — read/write with audit trail and public safety."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from database import SessionLocal
from models import AdminAuditLog, AppSetting


DEFAULTS: dict[tuple[str, str], dict[str, Any]] = {}

def _register(scope: str, key: str, value: Any, value_type: str = "string", is_public: bool = False, description: str = ""):
    DEFAULTS[(scope, key)] = {
        "value": str(value), "value_type": value_type,
        "is_public": is_public, "description": description,
    }

# ── Quote text & CTA ──
for site in ["default", "mfg", "gcindus", "gcnov"]:
    _register(f"quote:{site}", "disclaimer_template", "This estimate is for early cost evaluation. Final pricing may vary based on material grade, tolerances, finishing requirements, inspection needs, and lead time. For an exact quote, contact our engineers for a fast formal review.", is_public=True, description="Estimate disclaimer shown below results")
    _register(f"quote:{site}", "contact_note", "Looking for more material grades, custom materials, machining processes, or finishing options?", is_public=True, description="Inquiry note text above materials")
    _register(f"quote:{site}", "privacy_note", "By submitting this form, you confirm that you are authorized to share the uploaded file. If you provide contact details, we use them only to generate and follow up on your manufacturing estimate. We treat uploaded drawings and quote data as confidential business information.", is_public=True, description="Privacy compliance text below form")
    _register(f"quote:{site}", "formal_quote_label", "Request Formal Quote" if site in ("default","mfg") else "Request a Quote", is_public=True, description="CTA button text")
    _register(f"quote:{site}", "formal_quote_url", {
        "mfg": "https://mfg-solution.com/request-quote/",
        "gcindus": "https://gcindus.com/get-a-quotation/",
        "gcnov": "https://gcnov.com/contact/",
        "default": "https://mfg-solution.com/request-quote/",
    }[site], "url", is_public=True, description="Formal quote landing page URL")
    _register(f"quote:{site}", "engineer_contact_label", "Contact our engineers", is_public=True, description="Engineer contact link text")
    _register(f"quote:{site}", "engineer_contact_url", {
        "mfg": "https://mfg-solution.com/request-quote/",
        "gcindus": "https://gcindus.com/get-a-quotation/",
        "gcnov": "https://gcnov.com/contact/",
        "default": "https://mfg-solution.com/request-quote/",
    }[site], "url", is_public=True, description="Engineer contact link URL")

# ── Quote form rules ──
for site in ["default", "mfg", "gcindus", "gcnov"]:
    _register(f"quote:{site}", "customer_name_required", "true", "bool", is_public=True, description="Require customer name field")
    _register(f"quote:{site}", "customer_email_required", "true", "bool", is_public=True, description="Require customer email field")
    _register(f"quote:{site}", "quantity_min", "1", "number", is_public=True, description="Minimum quantity allowed")
    _register(f"quote:{site}", "quantity_max", "100000", "number", is_public=True, description="Maximum quantity allowed")
    _register(f"quote:{site}", "upload_max_mb", "50", "number", is_public=True, description="Max upload size in MB")
    _register(f"quote:{site}", "allowed_extensions", '["stp","step"]', "json", is_public=True, description="Allowed file extensions")

# ── Watermark ──
for site in ["default", "mfg", "gcindus", "gcnov"]:
    _register(f"quote:{site}", "preview_watermark_text", "GCNOV CO., LIMITED", is_public=False, description="Watermark text on STEP previews")
    _register(f"quote:{site}", "preview_watermark_opacity", "0.12", "number", is_public=False, description="Watermark opacity (0.02-0.35)")
    _register(f"quote:{site}", "preview_watermark_angle", "45", "number", is_public=False, description="Watermark angle in degrees")
    _register(f"quote:{site}", "preview_watermark_spacing", "3.0", "number", is_public=False, description="Watermark spacing multiplier")
    _register(f"quote:{site}", "preview_watermark_color", "#26303e", "color", is_public=False, description="Watermark text color (hex)")
    _register(f"quote:{site}", "preview_watermark_font_scale", "0.026", "number", is_public=False, description="Font scale factor")

# ── Thumbnail render ──
for site in ["default", "mfg", "gcindus", "gcnov"]:
    _register(f"quote:{site}", "thumbnail_background_color", "#f0f0f5", "color", is_public=False, description="CAD preview background color")
    _register(f"quote:{site}", "thumbnail_part_color", "#949aa3", "color", is_public=False, description="CAD preview part color")
    _register(f"quote:{site}", "thumbnail_width", "3840", "number", is_public=False, description="Preview image width (px)")
    _register(f"quote:{site}", "thumbnail_height", "2880", "number", is_public=False, description="Preview image height (px)")


def _seed_defaults():
    """Insert missing defaults into the database. Called on first access."""
    session = SessionLocal()
    try:
        for (scope, key), spec in DEFAULTS.items():
            existing = session.query(AppSetting).filter_by(scope=scope, key=key).first()
            if not existing:
                row = AppSetting(
                    scope=scope, key=key,
                    value=spec["value"], value_type=spec.get("value_type", "string"),
                    is_public=spec.get("is_public", False),
                    description=spec.get("description", ""),
                )
                session.add(row)
        session.commit()
    finally:
        session.close()
        SessionLocal.remove()


def get_setting(scope: str, key: str, default: str = "") -> str:
    """Read a single setting value by scope + key. Seeds defaults on first access."""
    _seed_defaults()
    session = SessionLocal()
    try:
        row = session.query(AppSetting).filter_by(scope=scope, key=key).first()
        return row.value if row else default
    finally:
        session.close()
        SessionLocal.remove()


def get_public_settings(tool: str = "quote", site: str = "default") -> dict[str, Any]:
    """Return all is_public=True settings for a given tool:site scope, plus global fallback."""
    _seed_defaults()
    session = SessionLocal()
    try:
        result = {}
        scopes = [f"{tool}:{site}", f"{tool}:default", "global"]
        rows = session.query(AppSetting).filter(
            AppSetting.scope.in_(scopes), AppSetting.is_public == True
        ).order_by(AppSetting.scope).all()
        for row in rows:
            result[row.key] = _cast_value(row.value, row.value_type)
        return result
    finally:
        session.close()
        SessionLocal.remove()


def get_all_settings(scope: str | None = None) -> list[dict]:
    """Return all settings, optionally filtered by scope. Admin use only."""
    _seed_defaults()
    session = SessionLocal()
    try:
        q = session.query(AppSetting)
        if scope:
            q = q.filter(AppSetting.scope == scope)
        return [_row_to_dict(r) for r in q.order_by(AppSetting.scope, AppSetting.key).all()]
    finally:
        session.close()
        SessionLocal.remove()


def update_setting(scope: str, key: str, value: Any, admin_username: str = "", client_ip: str = "", user_agent: str = "") -> bool:
    """Update a setting and log audit. Returns False if invalid."""
    spec = DEFAULTS.get((scope, key), {})
    value_type = spec.get("value_type", "string")
    str_value = str(value)
    if not _validate_value(str_value, value_type):
        return False
    _seed_defaults()
    session = SessionLocal()
    try:
        row = session.query(AppSetting).filter_by(scope=scope, key=key).first()
        if not row:
            row = AppSetting(scope=scope, key=key, value_type=value_type, is_public=spec.get("is_public", False))
            session.add(row)
        old_value = row.value
        row.value = str_value
        row.updated_by = admin_username
        row.updated_at = datetime.utcnow()

        audit = AdminAuditLog(
            admin_username=admin_username, action="update_setting",
            target_type="setting", target_key=f"{scope}/{key}",
            old_value=old_value, new_value=str_value,
            client_ip=client_ip, user_agent=user_agent,
        )
        session.add(audit)
        session.commit()
        return True
    finally:
        session.close()
        SessionLocal.remove()


def log_admin_action(admin_username: str, action: str, target_type: str = "", target_key: str = "", client_ip: str = "", user_agent: str = ""):
    session = SessionLocal()
    try:
        audit = AdminAuditLog(
            admin_username=admin_username, action=action,
            target_type=target_type, target_key=target_key,
            client_ip=client_ip, user_agent=user_agent,
        )
        session.add(audit)
        session.commit()
    finally:
        session.close()
        SessionLocal.remove()


def get_audit_logs(limit: int = 100) -> list[dict]:
    session = SessionLocal()
    try:
        rows = session.query(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit).all()
        return [_audit_to_dict(r) for r in rows]
    finally:
        session.close()
        SessionLocal.remove()


# ── Helpers ────────────────────────────────────

def _row_to_dict(row: AppSetting) -> dict:
    return {
        "id": row.id, "scope": row.scope, "key": row.key,
        "value": row.value, "value_type": row.value_type,
        "is_public": row.is_public, "description": row.description,
        "updated_by": row.updated_by, "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }

def _audit_to_dict(row: AdminAuditLog) -> dict:
    return {
        "id": row.id, "admin_username": row.admin_username, "action": row.action,
        "target_type": row.target_type, "target_key": row.target_key,
        "old_value": row.old_value, "new_value": row.new_value,
        "client_ip": row.client_ip, "created_at": row.created_at.isoformat() if row.created_at else None,
    }

def _cast_value(value: str, value_type: str) -> Any:
    if value_type == "bool":
        return value.lower() in ("true", "1", "yes")
    if value_type == "number":
        try: return float(value) if "." in value else int(value)
        except ValueError: return value
    if value_type == "json":
        import json
        try: return json.loads(value)
        except: return value
    return value

def _validate_value(value: str, value_type: str) -> bool:
    if value_type == "url" and value and not value.startswith("https://"):
        return False
    if value_type == "color" and value and not (len(value) == 7 and value.startswith("#")):
        return False
    if value_type == "number":
        try:
            float(value)
        except ValueError:
            return False
    return True
