"""Create a metadata-only inventory of the legacy SQLite database."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = PROJECT_ROOT / "backend" / "data" / "daiyujin.db"


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _rows_as_dicts(cursor: sqlite3.Cursor) -> list[dict[str, Any]]:
    names = [column[0] for column in cursor.description or []]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def _schema_hash(conn: sqlite3.Connection) -> str:
    statements = [
        row[0] or ""
        for row in conn.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type IN ('table', 'index', 'trigger', 'view') "
            "ORDER BY type, name"
        )
    ]
    payload = "\n".join(statements).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def inventory(database_path: Path) -> dict[str, Any]:
    resolved = database_path.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"SQLite database not found: {resolved}")

    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    try:
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
                "ORDER BY name"
            )
        ]
        tables: list[dict[str, Any]] = []
        for table_name in table_names:
            quoted = _quote_identifier(table_name)
            row_count = connection.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
            columns = _rows_as_dicts(connection.execute(f"PRAGMA table_info({quoted})"))
            foreign_keys = _rows_as_dicts(connection.execute(f"PRAGMA foreign_key_list({quoted})"))
            indexes = _rows_as_dicts(connection.execute(f"PRAGMA index_list({quoted})"))
            tables.append(
                {
                    "table": table_name,
                    "row_count": row_count,
                    "columns": columns,
                    "foreign_keys": foreign_keys,
                    "indexes": indexes,
                }
            )

        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "database_filename": resolved.name,
            "database_size_bytes": resolved.stat().st_size,
            "schema_sha256": _schema_hash(connection),
            "quick_check": integrity,
            "table_count": len(tables),
            "tables": tables,
        }
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    report = inventory(args.database)
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
        print(f"Legacy inventory written: {args.output.resolve()}")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
