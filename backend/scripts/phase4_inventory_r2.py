"""Inventory R2 objects and reconcile them with the legacy media index."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = PROJECT_ROOT / "backend" / "data" / "daiyujin.db"
DEFAULT_ENV_FILE = PROJECT_ROOT / "backend" / ".env"
R2_ENV_NAMES = {
    "R2_ACCESS_KEY_ID",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ENDPOINT_URL",
    "R2_REGION",
    "R2_SECRET_ACCESS_KEY",
}


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _load_env_subset(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Environment file not found: {path}")
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name not in R2_ENV_NAMES or name in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[name] = value


def _endpoint() -> str:
    explicit = os.environ.get("R2_ENDPOINT_URL") or os.environ.get("R2_ENDPOINT")
    if explicit:
        return explicit.rstrip("/")
    account_id = str(os.environ.get("R2_ACCOUNT_ID") or "").strip()
    if account_id:
        return f"https://{account_id}.r2.cloudflarestorage.com"
    return ""


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def read_indexed_r2_objects(database: Path) -> list[dict[str, Any]]:
    if not database.is_file():
        raise FileNotFoundError(f"Legacy database not found: {database}")
    connection = sqlite3.connect(f"file:{database.resolve().as_posix()}?mode=ro", uri=True)
    try:
        if not _table_exists(connection, "portal_order_media"):
            return []
        rows = connection.execute(
            "SELECT storage_key, COALESCE(file_size, 0) "
            "FROM portal_order_media WHERE LOWER(COALESCE(storage_backend, ''))='r2'"
        ).fetchall()
        return [
            {"key": str(key or "").strip(), "size_bytes": int(size or 0)}
            for key, size in rows
            if str(key or "").strip()
        ]
    finally:
        connection.close()


def list_r2_objects(client: Any, bucket: str, prefix: str) -> tuple[list[dict[str, Any]], int]:
    paginator = client.get_paginator("list_objects_v2")
    objects: list[dict[str, Any]] = []
    page_count = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        page_count += 1
        for item in page.get("Contents", []):
            key = str(item.get("Key") or "")
            if not key:
                continue
            modified = item.get("LastModified")
            objects.append(
                {
                    "key": key,
                    "size_bytes": int(item.get("Size") or 0),
                    "etag": str(item.get("ETag") or "").strip('"'),
                    "last_modified_utc": (
                        modified.astimezone(UTC).isoformat()
                        if hasattr(modified, "astimezone")
                        else None
                    ),
                }
            )
    return objects, page_count


def reconcile_r2_inventory(
    indexed: list[dict[str, Any]],
    provider: list[dict[str, Any]],
) -> dict[str, Any]:
    indexed_keys = [str(item["key"]) for item in indexed]
    provider_keys = [str(item["key"]) for item in provider]
    indexed_counts = Counter(indexed_keys)
    provider_counts = Counter(provider_keys)
    indexed_by_key = {str(item["key"]): item for item in indexed}
    provider_by_key = {str(item["key"]): item for item in provider}
    missing_from_provider = sorted(set(indexed_by_key) - set(provider_by_key))
    unindexed_in_provider = sorted(set(provider_by_key) - set(indexed_by_key))
    size_mismatches = sorted(
        key
        for key in set(indexed_by_key) & set(provider_by_key)
        if int(indexed_by_key[key]["size_bytes"]) > 0
        and int(indexed_by_key[key]["size_bytes"]) != int(provider_by_key[key]["size_bytes"])
    )
    duplicate_index_keys = sorted(key for key, count in indexed_counts.items() if count > 1)
    duplicate_provider_keys = sorted(key for key, count in provider_counts.items() if count > 1)
    integrity_ok = not (
        missing_from_provider
        or size_mismatches
        or duplicate_index_keys
        or duplicate_provider_keys
    )
    return {
        "result": "pass" if integrity_ok else "fail",
        "integrity_status": "clean" if integrity_ok else "anomalies_detected",
        "indexed_record_count": len(indexed),
        "provider_object_count": len(provider),
        "indexed_total_size_bytes": sum(int(item["size_bytes"]) for item in indexed),
        "provider_total_size_bytes": sum(int(item["size_bytes"]) for item in provider),
        "missing_from_provider_count": len(missing_from_provider),
        "unindexed_in_provider_count": len(unindexed_in_provider),
        "size_mismatch_count": len(size_mismatches),
        "duplicate_index_key_count": len(duplicate_index_keys),
        "duplicate_provider_key_count": len(duplicate_provider_keys),
        "missing_from_provider_key_hashes": [_sha256_text(key) for key in missing_from_provider],
        "unindexed_in_provider_key_hashes": [_sha256_text(key) for key in unindexed_in_provider],
        "size_mismatch_key_hashes": [_sha256_text(key) for key in size_mismatches],
        "objects": [
            {
                "key_sha256": _sha256_text(str(item["key"])),
                "size_bytes": int(item["size_bytes"]),
                "etag_sha256": _sha256_text(str(item.get("etag") or "")),
                "last_modified_utc": item.get("last_modified_utc"),
            }
            for item in provider
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--prefix", default="portal/")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    output = args.output.resolve()
    if "_private" not in {part.lower() for part in output.parts}:
        raise ValueError("R2 inventory evidence must be written under a _private directory")
    _load_env_subset(args.env_file.resolve())
    endpoint = _endpoint()
    bucket = str(os.environ.get("R2_BUCKET") or "").strip()
    access_key = str(os.environ.get("R2_ACCESS_KEY_ID") or "").strip()
    secret_key = str(os.environ.get("R2_SECRET_ACCESS_KEY") or "").strip()
    if not all((endpoint, bucket, access_key, secret_key)):
        raise RuntimeError("R2 configuration is incomplete")

    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError("R2 inventory requires boto3 and botocore") from exc

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=str(os.environ.get("R2_REGION") or "auto"),
        config=Config(
            signature_version="s3v4",
            connect_timeout=10,
            read_timeout=30,
            retries={"max_attempts": 4, "mode": "standard"},
        ),
    )
    provider, page_count = list_r2_objects(client, bucket, args.prefix)
    indexed = read_indexed_r2_objects(args.database.resolve())
    report = {
        "report_type": "r2_object_inventory",
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "bucket_name_sha256": _sha256_text(bucket),
        "prefix": args.prefix,
        "provider_page_count": page_count,
        **reconcile_r2_inventory(indexed, provider),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(
        "R2 inventory written: "
        f"objects={report['provider_object_count']} "
        f"indexed={report['indexed_record_count']} "
        f"result={report['result']}"
    )
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
