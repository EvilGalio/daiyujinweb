"""Portal audit log — independent from Admin Console settings audit."""

import json
from datetime import datetime
from flask import request

from database import SessionLocal
from models import PortalAuditLog


def log_portal_action(session, actor, action, entity_type="", entity_id=None, entity_label="", before=None, after=None):
    """Write a portal audit log entry within an existing session.

    actor: dict with id / email / role keys (typically from _current_user())
    session: the current SQLAlchemy session; caller is responsible for commit/rollback.
    """
    entry = PortalAuditLog(
        actor_user_id=actor.get("id") if isinstance(actor, dict) else None,
        actor_email=actor.get("email") if isinstance(actor, dict) else getattr(actor, "get", lambda _: None)("email"),
        actor_role=actor.get("role") if isinstance(actor, dict) else getattr(actor, "get", lambda _: None)("role"),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=str(entity_label)[:255] if entity_label else None,
        before_json=json.dumps(before, ensure_ascii=False) if before else None,
        after_json=json.dumps(after, ensure_ascii=False) if after else None,
        client_ip=request.remote_addr or "",
        user_agent=(request.user_agent.string or "")[:255] if request and hasattr(request, "user_agent") else "",
    )
    session.add(entry)
    session.flush()
    return entry.id


def list_portal_audit_logs(session, limit=200, actor_email=None, actor_role=None, action=None, entity_type=None):
    """Return portal audit log entries, optionally filtered."""
    q = session.query(PortalAuditLog)
    if actor_email:
        q = q.filter(PortalAuditLog.actor_email == actor_email)
    if actor_role:
        q = q.filter(PortalAuditLog.actor_role == actor_role)
    if action:
        q = q.filter(PortalAuditLog.action == action)
    if entity_type:
        q = q.filter(PortalAuditLog.entity_type == entity_type)
    rows = q.order_by(PortalAuditLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "actor_user_id": r.actor_user_id,
            "actor_email": r.actor_email,
            "actor_role": r.actor_role,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "entity_label": r.entity_label,
            "client_ip": r.client_ip,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
