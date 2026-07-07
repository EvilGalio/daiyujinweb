"""Phase 1 migration for Portal media R2 support.

Adds local/R2 storage metadata columns to portal_order_media and introduces
portal_pending_uploads for upload workflows.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, get_database_url  # noqa: E402
from models import PortalPendingUpload  # noqa: E402


def sqlite_db_path() -> Path | None:
    url = get_database_url()
    if not url.startswith("sqlite:///"):
        return None
    return Path(url.removeprefix("sqlite:///"))


def ensure_backup() -> None:
    db_path = sqlite_db_path()
    if not db_path or not db_path.exists():
        print("Backup skipped: no local SQLite DB file found")
        return
    bak = db_path.with_name(db_path.name + f".media_r2_backup_{datetime.now():%Y%m%d_%H%M%S}")
    shutil.copy2(db_path, bak)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{db_path}{suffix}")
        if sidecar.exists():
            shutil.copy2(sidecar, Path(f"{bak}{suffix}"))
    print(f"Database backup: {bak}")


def is_lock_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "database is locked" in msg or "database is busy" in msg


def execute_sql_with_retry(
    conn,
    sql: str,
    params: dict | None = None,
    *,
    action: str,
    dry_run: bool,
) -> bool:
    if dry_run:
        print(f"  dry-run: {action}")
        return True

    for attempt in range(1, 4):
        try:
            conn.execute(text(sql), params or {})
            return True
        except OperationalError as exc:
            if is_lock_error(exc) and attempt < 3:
                delay = 0.5 * attempt
                print(f"  retrying ({attempt}/3): {action} after lock")
                time.sleep(delay)
                continue
            raise

    return False


def execute_callable_with_retry(action_fn, *, action: str, dry_run: bool) -> bool:
    if dry_run:
        print(f"  dry-run: {action}")
        return True

    for attempt in range(1, 4):
        try:
            action_fn()
            return True
        except OperationalError as exc:
            if is_lock_error(exc) and attempt < 3:
                delay = 0.5 * attempt
                print(f"  retrying ({attempt}/3): {action} after lock")
                time.sleep(delay)
                continue
            raise

    return False


def get_columns(inspected_conn, table_name: str) -> set[str]:
    return {c["name"] for c in inspect(inspected_conn).get_columns(table_name)}


def ensure_column(conn, table_name: str, col_name: str, ddl: str, *, dry_run: bool) -> bool:
    cols = get_columns(conn, table_name)
    if col_name in cols:
        print(f"  exists: {table_name}.{col_name}")
        return False

    sql = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {ddl}"
    if execute_sql_with_retry(conn, sql, action=f"add {table_name}.{col_name}", dry_run=dry_run):
        print(f"  add: {table_name}.{col_name}")
        return True
    return False


def backfill_media_columns(conn, *, dry_run: bool) -> None:
    if dry_run:
        print("  dry-run: backfill portal_order_media.storage_backend='local' where null")
        print("  dry-run: backfill portal_order_media.storage_key from stored_filename where missing")
        return

    execute_sql_with_retry(
        conn,
        """
        UPDATE portal_order_media
           SET storage_backend = COALESCE(storage_backend, 'local')
         WHERE storage_backend IS NULL OR storage_backend = ''
        """,
        action="backfill storage_backend to 'local'",
        dry_run=False,
    )
    execute_sql_with_retry(
        conn,
        """
        UPDATE portal_order_media
           SET storage_key = COALESCE(storage_key, stored_filename)
         WHERE storage_key IS NULL OR storage_key = ''
        """,
        action="backfill storage_key from stored_filename",
        dry_run=False,
    )


def ensure_portal_pending_uploads(conn, *, dry_run: bool) -> bool:
    if "portal_pending_uploads" in get_table_names(conn):
        print("  exists: portal_pending_uploads")
        return False

    def _create_table() -> None:
        PortalPendingUpload.__table__.create(bind=conn, checkfirst=False)

    if execute_callable_with_retry(
        _create_table,
        action="create table portal_pending_uploads",
        dry_run=dry_run,
    ):
        print("  create: portal_pending_uploads")
        return True
    return False


def get_table_names(conn) -> set[str]:
    return set(inspect(conn).get_table_names())


def migrate(dry_run: bool = False) -> None:
    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys = ON"))
        conn.execute(text("PRAGMA busy_timeout = 30000"))
        table_names = get_table_names(conn)
        if "portal_order_media" not in table_names:
            raise RuntimeError("portal_order_media table not found, abort migration")

        changes = 0
        for col_name, ddl in [
            ("storage_backend", "VARCHAR(20) NOT NULL DEFAULT 'local'"),
            ("storage_key", "VARCHAR(500)"),
            ("storage_bucket", "VARCHAR(120)"),
            ("etag", "VARCHAR(160)"),
        ]:
            if ensure_column(conn, "portal_order_media", col_name, ddl, dry_run=dry_run):
                changes += 1

        if "portal_pending_uploads" in get_table_names(conn):
            if ensure_column(conn, "portal_pending_uploads", "media_id", "INTEGER", dry_run=dry_run):
                changes += 1

        backfill_media_columns(conn, dry_run=dry_run)
        if ensure_portal_pending_uploads(conn, dry_run=dry_run):
            changes += 1

        if not dry_run:
            table_names = get_table_names(conn)
            if "portal_pending_uploads" in table_names:
                count = conn.execute(text("SELECT COUNT(*) FROM portal_pending_uploads")).scalar_one()
                print(f"  count portal_pending_uploads={count}")

        if dry_run:
            print(
                "Migration dry-run complete."
                + (f" Would apply {changes} schema change(s)." if changes else " No schema change required.")
            )
        elif changes == 0:
            print("Migration applied. No schema changes were required.")
        else:
            print(f"Migration applied. {changes} schema change(s).")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Migrate portal media schema for R2 support")
    p.add_argument("--backup", action="store_true", help="Backup local SQLite DB before migration")
    p.add_argument("--dry-run", action="store_true", help="Show planned changes without applying")
    args = p.parse_args()

    if args.backup:
        ensure_backup()

    migrate(dry_run=args.dry_run)
