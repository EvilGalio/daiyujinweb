"""Reset Order Portal runtime data and seed clean starter accounts.

This script intentionally touches only Portal tables and Portal media files.
It does not delete quote inquiries, freight data, settings, exchange rates, or
quote model data.

Usage from project root:
    python backend/scripts/reset_portal_data.py
    python backend/scripts/reset_portal_data.py --confirm RESET_PORTAL
"""

from __future__ import annotations

import argparse
import secrets
import shutil
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from database import Base, SessionLocal, engine, get_database_url, init_db  # noqa: E402
from models import (  # noqa: E402
    PortalAuditLog,
    PortalEvent,
    PortalMessage,
    PortalOrder,
    PortalOrderMedia,
    PortalOrderUpdate,
    PortalSecurityLog,
    PortalSession,
    PortalUser,
)


CONFIRM_TEXT = "RESET_PORTAL"
PORTAL_MODELS = [
    PortalMessage,
    PortalOrderMedia,
    PortalOrderUpdate,
    PortalEvent,
    PortalAuditLog,
    PortalSecurityLog,
    PortalSession,
    PortalOrder,
    PortalUser,
]
PORTAL_TABLE_NAMES = [model.__tablename__ for model in PORTAL_MODELS]
MEDIA_DIR = BACKEND_ROOT / "private" / "order_media"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backup and reset only the Order Portal tables/media."
    )
    parser.add_argument(
        "--confirm",
        default="",
        help=f"Required for deletion. Must be exactly {CONFIRM_TEXT}.",
    )
    parser.add_argument(
        "--backup-dir",
        default=str(PROJECT_ROOT / "_private" / "backups" / "portal_reset"),
        help="Backup root directory.",
    )
    parser.add_argument("--admin-email", default="admin@daiyujin.com")
    parser.add_argument("--sales-email", default="sales@daiyujin.com")
    parser.add_argument(
        "--admin-password",
        default="",
        help="Optional fixed admin password. Random password is generated if omitted.",
    )
    parser.add_argument(
        "--sales-password",
        default="",
        help="Optional fixed sales password. Random password is generated if omitted.",
    )
    parser.add_argument(
        "--no-seed",
        action="store_true",
        help="Do not recreate admin/sales starter accounts after reset.",
    )
    parser.add_argument(
        "--keep-media",
        action="store_true",
        help="Keep files in backend/private/order_media. Database rows are still deleted.",
    )
    return parser.parse_args()


def count_rows(session) -> dict[str, int | str]:
    counts: dict[str, int | str] = {}
    table_names = set(inspect(engine).get_table_names())
    for table in PORTAL_TABLE_NAMES:
        if table not in table_names:
            counts[table] = "missing"
            continue
        counts[table] = session.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()
    return counts


def print_counts(title: str, counts: dict[str, int | str]) -> None:
    print(f"\n{title}")
    print("-" * len(title))
    for table, count in counts.items():
        print(f"{table:24} {count}")


def sqlite_database_path() -> Path | None:
    url = get_database_url()
    if not url.startswith("sqlite:///"):
        return None
    raw = url.removeprefix("sqlite:///")
    return Path(raw)


def backup_runtime_state(backup_root: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = backup_root / timestamp
    backup_dir.mkdir(parents=True, exist_ok=True)

    db_path = sqlite_database_path()
    if db_path and db_path.exists():
        shutil.copy2(db_path, backup_dir / db_path.name)
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(db_path) + suffix)
            if sidecar.exists():
                shutil.copy2(sidecar, backup_dir / sidecar.name)
        print(f"Database backup: {backup_dir / db_path.name}")
    elif db_path:
        print(f"Database file not found, skipped DB backup: {db_path}")
    else:
        print("DATABASE_URL is not SQLite. Portal rows will be deleted, but no DB file backup was created.")

    if MEDIA_DIR.exists():
        media_backup = backup_dir / "order_media"
        shutil.copytree(MEDIA_DIR, media_backup)
        print(f"Media backup:    {media_backup}")
    else:
        print(f"Media directory not found, skipped media backup: {MEDIA_DIR}")

    return backup_dir


def reset_sqlite_sequences(session) -> None:
    if not get_database_url().startswith("sqlite"):
        return
    exists = session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
    ).scalar_one_or_none()
    if not exists:
        return
    placeholders = ", ".join(f":t{i}" for i, _ in enumerate(PORTAL_TABLE_NAMES))
    params = {f"t{i}": table for i, table in enumerate(PORTAL_TABLE_NAMES)}
    session.execute(
        text(f"DELETE FROM sqlite_sequence WHERE name IN ({placeholders})"),
        params,
    )


def delete_portal_rows(session) -> None:
    table_names = set(inspect(engine).get_table_names())
    for table in PORTAL_TABLE_NAMES:
        if table in table_names:
            session.execute(text(f'DELETE FROM "{table}"'))
    session.flush()
    reset_sqlite_sequences(session)


def ensure_column(conn, table_name: str, column_name: str, column_type: str, default=None) -> None:
    inspector = inspect(engine)
    if table_name not in inspector.get_table_names():
        return
    current = {col["name"] for col in inspector.get_columns(table_name)}
    if column_name in current:
        return
    if default is None:
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
        return
    default_sql = f"'{default}'" if isinstance(default, str) else str(default)
    conn.execute(
        text(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} "
            f"{column_type} NOT NULL DEFAULT {default_sql}"
        )
    )


def ensure_portal_security_schema() -> None:
    """Bring older Portal databases up to the R6 security schema."""
    with engine.begin() as conn:
        for column_name, column_type, default in [
            ("session_version", "INTEGER", 1),
            ("password_changed_at", "TIMESTAMP", None),
            ("locked_until", "TIMESTAMP", None),
            ("last_failed_login_at", "TIMESTAMP", None),
            ("failed_login_count", "INTEGER", 0),
            ("last_login_at", "TIMESTAMP", None),
        ]:
            ensure_column(conn, "portal_users", column_name, column_type, default)

        for column_name, column_type, default in [
            ("session_version", "INTEGER", 1),
            ("revoked_reason", "VARCHAR(80)", None),
            ("last_ip", "VARCHAR(80)", None),
            ("last_user_agent", "VARCHAR(255)", None),
        ]:
            ensure_column(conn, "portal_sessions", column_name, column_type, default)

        if "portal_security_logs" not in inspect(engine).get_table_names():
            Base.metadata.tables["portal_security_logs"].create(bind=engine)


def reset_media_dir() -> None:
    if MEDIA_DIR.exists():
        shutil.rmtree(MEDIA_DIR)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)


def seed_starter_accounts(session, args: argparse.Namespace) -> list[tuple[str, str, str]]:
    created: list[tuple[str, str, str]] = []
    now = datetime.utcnow()

    admin_password = args.admin_password or secrets.token_urlsafe(12)
    sales_password = args.sales_password or secrets.token_urlsafe(12)

    accounts = [
        (args.admin_email.strip().lower(), admin_password, "admin", "Portal Admin"),
        (args.sales_email.strip().lower(), sales_password, "sales", "Sales Rep"),
    ]

    for email, password, role, name in accounts:
        if not email:
            continue
        session.add(
            PortalUser(
                email=email,
                password_hash=generate_password_hash(password),
                role=role,
                display_name=name,
                status="active",
                session_version=1,
                must_change_password=True,
                password_changed_at=None,
                failed_login_count=0,
                locked_until=None,
                last_failed_login_at=None,
                last_login_at=None,
                created_at=now,
                updated_at=now,
            )
        )
        created.append((email, password, role))
    return created


def main() -> int:
    args = parse_args()
    init_db()
    ensure_portal_security_schema()

    session = SessionLocal()
    try:
        before = count_rows(session)
        print_counts("Current Portal row counts", before)

        if args.confirm != CONFIRM_TEXT:
            print("\nDry run only. Nothing was deleted.")
            print(f"To reset Portal data, run again with: --confirm {CONFIRM_TEXT}")
            return 0

        print("\nConfirmation accepted. Resetting Portal data...")
        backup_dir = backup_runtime_state(Path(args.backup_dir))
        print(f"Backup folder:   {backup_dir}")

        delete_portal_rows(session)
        if not args.keep_media:
            reset_media_dir()
        else:
            print(f"Media kept:      {MEDIA_DIR}")

        created_accounts: list[tuple[str, str, str]] = []
        if not args.no_seed:
            created_accounts = seed_starter_accounts(session, args)

        session.commit()
        after = count_rows(session)
        print_counts("Portal row counts after reset", after)

        if created_accounts:
            print("\nStarter accounts")
            print("----------------")
            for email, password, role in created_accounts:
                print(f"{role:6} {email} / {password}")
            print("\nThese accounts are marked must_change_password=True.")
        else:
            print("\nNo starter accounts were created because --no-seed was used.")

        print("\nDone. Restart the API before testing a fresh login.")
        return 0
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        SessionLocal.remove()


if __name__ == "__main__":
    raise SystemExit(main())
