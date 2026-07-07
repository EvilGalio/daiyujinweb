"""Portal event stream — emit events for real-time frontend sync."""
import json
import threading
from datetime import datetime

from models import PortalEvent, PortalUser

_EVENT_CONDITION = threading.Condition()


def notify_portal_events():
    with _EVENT_CONDITION:
        _EVENT_CONDITION.notify_all()


def wait_for_portal_events(timeout=1.0):
    with _EVENT_CONDITION:
        _EVENT_CONDITION.wait(timeout)


def emit_portal_event(session, event_type, entity_type, entity_id=None, order_id=None,
                      actor_user_id=None, visibility="internal", payload=None):
    """Write an event to portal_events within the current session. Caller commits."""
    event = PortalEvent(
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        order_id=order_id,
        actor_user_id=actor_user_id,
        visibility=visibility,
        payload_json=json.dumps(payload or {}, ensure_ascii=False),
    )
    session.add(event)
    return event


def query_visible_events(session, user, after_id=0, limit=50):
    """Return events visible to the given user, ordered by id ASC."""
    from models import PortalOrder

    q = session.query(PortalEvent).filter(PortalEvent.id > int(after_id or 0))

    if user["role"] == "customer":
        order_ids = [o.id for o in session.query(PortalOrder.id).filter(
            PortalOrder.customer_user_id == user["id"]
        ).all()]
        if not order_ids:
            return []
        q = q.filter(
            PortalEvent.order_id.in_(order_ids),
            PortalEvent.visibility == "public",
        )
    elif user["role"] == "sales":
        order_ids = [o.id for o in session.query(PortalOrder.id).filter(
            PortalOrder.sales_user_id == user["id"]
        ).all()]
        if not order_ids:
            return []
        q = q.filter(
            PortalEvent.order_id.in_(order_ids),
            PortalEvent.visibility.in_(["public", "internal"]),
        )

    rows = q.order_by(PortalEvent.id.asc()).limit(limit).all()
    return [_event_to_dict(r) for r in rows]


def _event_to_dict(e: PortalEvent) -> dict:
    return {
        "id": e.id,
        "order_id": e.order_id,
        "event_type": e.event_type,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "visibility": e.visibility,
        "payload": json.loads(e.payload_json) if e.payload_json else {},
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
