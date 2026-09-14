"""Configure only X IND quote recipients in an existing SQLite database."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3


SCOPE = "quote:xindus"
DESIRED = {
    "quote_email_recipients": ("johnson@x-indus.com", "string"),
    "quote_email_enabled": ("true", "bool"),
}
ACTOR = "xindus-mail-setup"


def configure(database: Path, *, apply: bool = False) -> dict:
    database = database.resolve(strict=True)
    if not database.is_file():
        raise ValueError("An existing SQLite database file is required")
    mode = "rw" if apply else "ro"
    connection = sqlite3.connect(f"{database.as_uri()}?mode={mode}", uri=True, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        if apply:
            connection.execute("BEGIN IMMEDIATE")
        changes = []
        for key, (value, value_type) in DESIRED.items():
            rows = connection.execute(
                "SELECT id, value, value_type, is_public FROM app_settings "
                "WHERE scope = ? AND key = ?", (SCOPE, key),
            ).fetchall()
            if len(rows) > 1:
                raise ValueError(f"Duplicate settings for {SCOPE}/{key}")
            row = rows[0] if rows else None
            before = dict(row) if row else None
            changed = row is None or (
                row["value"] != value or row["value_type"] != value_type or row["is_public"] != 0
            )
            changes.append({"key": key, "before": before, "value": value, "changed": changed})
            if not apply or not changed:
                continue
            now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" ")
            if row is None:
                connection.execute(
                    "INSERT INTO app_settings "
                    "(scope, key, value, value_type, is_public, description, updated_by, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
                    (SCOPE, key, value, value_type, "X IND quote email routing", ACTOR, now, now),
                )
            else:
                connection.execute(
                    "UPDATE app_settings SET value = ?, value_type = ?, is_public = 0, "
                    "updated_by = ?, updated_at = ? WHERE id = ?",
                    (value, value_type, ACTOR, now, row["id"]),
                )
            connection.execute(
                "INSERT INTO admin_audit_logs "
                "(admin_username, action, target_type, target_key, old_value, new_value, "
                "client_ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ACTOR, "update_setting", "setting", f"{SCOPE}/{key}",
                 row["value"] if row else None, value, "", "configure_xindus_quote_email.py", now),
            )
        if apply:
            for key, (value, value_type) in DESIRED.items():
                row = connection.execute(
                    "SELECT value, value_type, is_public FROM app_settings WHERE scope = ? AND key = ?",
                    (SCOPE, key),
                ).fetchone()
                if tuple(row) != (value, value_type, 0):
                    raise RuntimeError(f"Verification failed for {SCOPE}/{key}")
            connection.commit()
        return {"database": str(database), "scope": SCOPE, "applied": apply, "changes": changes}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="Existing live SQLite database path")
    parser.add_argument("--apply", action="store_true", help="Apply and audit the two private X IND settings")
    args = parser.parse_args()
    print(json.dumps(configure(args.database, apply=args.apply), ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
