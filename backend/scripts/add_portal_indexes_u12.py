"""Add indexes to portal tables for query performance."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine


INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_portal_orders_customer_updated ON portal_orders(customer_user_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_portal_orders_sales_updated ON portal_orders(sales_user_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_portal_orders_stage ON portal_orders(current_stage)",
    "CREATE INDEX IF NOT EXISTS idx_portal_orders_updated ON portal_orders(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_portal_events_order ON portal_events(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_portal_events_order_vis_id ON portal_events(order_id, visibility, id)",
    "CREATE INDEX IF NOT EXISTS idx_portal_media_order ON portal_order_media(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_portal_messages_order ON portal_messages(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_portal_updates_order ON portal_order_updates(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_portal_sessions_token_active ON portal_sessions(token_hash, revoked_at, expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_portal_sessions_user ON portal_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_portal_security_email ON portal_security_logs(email, event_type)",
    "CREATE INDEX IF NOT EXISTS idx_portal_audit_actor ON portal_audit_logs(actor_user_id)",
]


def add_indexes():
    with engine.begin() as conn:
        for sql in INDEXES:
            try:
                conn.execute(text(sql))
                print(f"  OK: {sql.split('ON')[0].strip()}")
            except Exception as e:
                raise RuntimeError(f"Index creation failed: {sql}") from e

    print(f"\nIndex migration complete. {len(INDEXES)} indexes checked.")


if __name__ == "__main__":
    add_indexes()
