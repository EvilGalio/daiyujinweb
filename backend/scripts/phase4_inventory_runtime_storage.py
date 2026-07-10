"""Create a privacy-safe inventory of local runtime files and media indexes."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = PROJECT_ROOT / "backend" / "data" / "daiyujin.db"
DEFAULT_ROOTS = {
    "uploads": PROJECT_ROOT / "backend" / "uploads",
    "order_media": PROJECT_ROOT / "backend" / "private" / "order_media",
    "thumbnails": PROJECT_ROOT / "backend" / "static" / "thumbnails",
    "stl": PROJECT_ROOT / "backend" / "static" / "stl",
}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _root_inventory(root: Path, content_hashes: bool) -> dict[str, Any]:
    if not root.is_dir():
        return {
            "exists": False,
            "file_count": 0,
            "total_size_bytes": 0,
            "symlink_count": 0,
            "extensions": {},
            "oldest_mtime_utc": None,
            "newest_mtime_utc": None,
            "files": [],
        }

    records: list[dict[str, Any]] = []
    extension_counts: Counter[str] = Counter()
    symlink_count = 0
    mtimes: list[float] = []
    total_size = 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            symlink_count += 1
            continue
        if not path.is_file():
            continue
        stat = path.stat()
        extension = path.suffix.lower() or "(none)"
        extension_counts[extension] += 1
        total_size += stat.st_size
        mtimes.append(stat.st_mtime)
        record: dict[str, Any] = {
            "extension": extension,
            "size_bytes": stat.st_size,
            "mtime_utc": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        }
        if content_hashes:
            record["content_sha256"] = _sha256_file(path)
        records.append(record)

    return {
        "exists": True,
        "file_count": len(records),
        "total_size_bytes": total_size,
        "symlink_count": symlink_count,
        "extensions": dict(sorted(extension_counts.items())),
        "oldest_mtime_utc": (
            datetime.fromtimestamp(min(mtimes), tz=UTC).isoformat() if mtimes else None
        ),
        "newest_mtime_utc": (
            datetime.fromtimestamp(max(mtimes), tz=UTC).isoformat() if mtimes else None
        ),
        "files": records,
    }


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def _media_index_inventory(database: Path) -> dict[str, Any]:
    if not database.is_file():
        return {"exists": False, "media": [], "pending_statuses": {}}

    connection = sqlite3.connect(f"file:{database.resolve().as_posix()}?mode=ro", uri=True)
    try:
        media: list[dict[str, Any]] = []
        duplicate_storage_keys = 0
        if _table_exists(connection, "portal_order_media"):
            rows = connection.execute(
                "SELECT COALESCE(storage_backend, 'unknown'), COUNT(*), "
                "COALESCE(SUM(file_size), 0), "
                "SUM(CASE WHEN storage_key IS NULL OR storage_key='' THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN visible_to_customer=1 THEN 1 ELSE 0 END) "
                "FROM portal_order_media GROUP BY COALESCE(storage_backend, 'unknown') "
                "ORDER BY COALESCE(storage_backend, 'unknown')"
            ).fetchall()
            media = [
                {
                    "storage_backend": row[0],
                    "record_count": row[1],
                    "total_size_bytes": row[2],
                    "missing_storage_key_count": row[3],
                    "customer_visible_count": row[4],
                }
                for row in rows
            ]
            duplicate_storage_keys = connection.execute(
                "SELECT COUNT(*) FROM ("
                "SELECT storage_backend, storage_key FROM portal_order_media "
                "WHERE storage_key IS NOT NULL AND storage_key<>'' "
                "GROUP BY storage_backend, storage_key HAVING COUNT(*)>1"
                ")"
            ).fetchone()[0]

        pending_statuses: dict[str, int] = {}
        if _table_exists(connection, "portal_pending_uploads"):
            pending_statuses = {
                str(status): int(count)
                for status, count in connection.execute(
                    "SELECT COALESCE(status, 'unknown'), COUNT(*) "
                    "FROM portal_pending_uploads "
                    "GROUP BY COALESCE(status, 'unknown') "
                    "ORDER BY COALESCE(status, 'unknown')"
                )
            }
        return {
            "exists": True,
            "media": media,
            "duplicate_storage_key_groups": duplicate_storage_keys,
            "pending_statuses": pending_statuses,
        }
    finally:
        connection.close()


def inventory(
    roots: dict[str, Path],
    database: Path,
    content_hashes: bool = False,
) -> dict[str, Any]:
    root_reports = {
        label: _root_inventory(path.resolve(), content_hashes)
        for label, path in sorted(roots.items())
    }
    return {
        "report_type": "runtime_storage_inventory",
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "content_hashes_enabled": content_hashes,
        "roots": root_reports,
        "totals": {
            "file_count": sum(report["file_count"] for report in root_reports.values()),
            "total_size_bytes": sum(
                report["total_size_bytes"] for report in root_reports.values()
            ),
            "symlink_count": sum(report["symlink_count"] for report in root_reports.values()),
        },
        "database_media_index": _media_index_inventory(database.resolve()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--content-hashes", action="store_true")
    args = parser.parse_args()

    report = inventory(DEFAULT_ROOTS, args.database, args.content_hashes)
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Runtime storage inventory written: {args.output.resolve()}")
    print(
        f"Files: {report['totals']['file_count']}; "
        f"bytes: {report['totals']['total_size_bytes']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
