"""R6 migration — add security fields to existing tables."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, inspect, Column, Integer, String, DateTime, Boolean
from database import engine, Base
from models import PortalUser, PortalSession, PortalSecurityLog


def ensure_column(cmds, table_name, col_name, col_type, fallback_value=None):
    """Add column if missing. cmds is a list of SQL strings to execute."""
    insp = inspect(engine)
    cols = [c['name'] for c in insp.get_columns(table_name)]
    if col_name not in cols:
        if fallback_value is not None:
            default_str = str(fallback_value) if not isinstance(fallback_value, str) else f"'{fallback_value}'"
            cmds.append(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type} NOT NULL DEFAULT {default_str}")
        else:
            cmds.append(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}")
        print(f"  + {table_name}.{col_name}")
    else:
        print(f"  ✓ {table_name}.{col_name} exists")


def migrate():
    with engine.begin() as conn:
        cmds = []

        # PortalUser additions
        for col, typ, default in [
            ("session_version", "INTEGER", 1),
            ("password_changed_at", "TIMESTAMP", None),
            ("locked_until", "TIMESTAMP", None),
            ("last_failed_login_at", "TIMESTAMP", None),
            ("failed_login_count", "INTEGER", 0),
            ("last_login_at", "TIMESTAMP", None),
        ]:
            ensure_column(cmds, "portal_users", col, typ, default)

        # PortalSession additions
        for col, typ, default in [
            ("session_version", "INTEGER", 1),
            ("revoked_reason", "VARCHAR(80)", None),
            ("last_ip", "VARCHAR(80)", None),
            ("last_user_agent", "VARCHAR(255)", None),
        ]:
            ensure_column(cmds, "portal_sessions", col, typ, default)

        # Create PortalSecurityLog table
        insp = inspect(engine)
        if "portal_security_logs" not in insp.get_table_names():
            Base.metadata.tables["portal_security_logs"].create(bind=engine)
            print("  + portal_security_logs table created")
        else:
            print("  ✓ portal_security_logs exists")

        for cmd in cmds:
            try:
                conn.execute(text(cmd))
            except Exception as e:
                raise RuntimeError(f"Migration failed on: {cmd}") from e

    print(f"\nMigration complete. {len(cmds)} alterations applied.")


if __name__ == "__main__":
    migrate()
