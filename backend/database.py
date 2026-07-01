from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker


BACKEND_ROOT = Path(__file__).resolve().parent
DATA_DIR = BACKEND_ROOT / "data"
DEFAULT_DATABASE_URL = f"sqlite:///{DATA_DIR / 'daiyujin.db'}"


class Base(DeclarativeBase):
    pass


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def get_engine():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if get_database_url().startswith("sqlite") else {}
    return create_engine(get_database_url(), future=True, connect_args=connect_args)


engine = get_engine()
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True))


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_sqlite_schema()


def _ensure_sqlite_schema() -> None:
    """Apply small additive SQLite migrations for existing local databases."""
    if not get_database_url().startswith("sqlite"):
        return

    inspector = inspect(engine)
    if "inquiries" not in inspector.get_table_names():
        return

    _ensure_inquiries_schema(inspector)


INQUIRY_COLUMNS: list[tuple[str, str]] = [
    ("part_name", "VARCHAR(255)"),
    ("created_at", "DATETIME NOT NULL"),
    ("customer_name", "VARCHAR(120)"),
    ("customer_email", "VARCHAR(255)"),
    ("quantity", "INTEGER"),
    ("material_name", "VARCHAR(160)"),
    ("volume_mm3", "FLOAT"),
    ("weight_kg", "FLOAT"),
    ("max_dim_mm", "FLOAT"),
    ("tolerance_grade", "VARCHAR(20)"),
    ("total_usd", "FLOAT"),
    ("total_display", "VARCHAR(40)"),
    ("currency", "VARCHAR(3)"),
    ("batch_id", "VARCHAR(80)"),
    ("batch_item_id", "VARCHAR(80)"),
    ("batch_item_index", "INTEGER"),
    ("batch_item_count", "INTEGER"),
    ("stp_filename", "VARCHAR(255)"),
    ("client_ip", "VARCHAR(80)"),
    ("user_agent", "VARCHAR(255)"),
    ("input_params", "TEXT NOT NULL"),
    ("result", "TEXT NOT NULL"),
    ("record_id", "INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT"),
]


def _ensure_inquiries_schema(inspector) -> None:
    current = [col["name"] for col in inspector.get_columns("inquiries")]
    desired = [name for name, _ in INQUIRY_COLUMNS]
    old_columns = {"id", "type", "stp_file_path", "email_sent_at", "email_status"}
    needs_rebuild = current != desired or bool(old_columns.intersection(current))
    if not needs_rebuild:
        return

    convert_utc_to_local = "id" in current or "type" in current
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM inquiries")).mappings().all()
        column_sql = ", ".join(f"{name} {sql_type}" for name, sql_type in INQUIRY_COLUMNS)
        conn.execute(text(f"CREATE TABLE inquiries_new ({column_sql})"))
        for row in rows:
            values = _normalize_inquiry_row(dict(row), convert_utc_to_local=convert_utc_to_local)
            placeholders = ", ".join(f":{name}" for name, _ in INQUIRY_COLUMNS)
            names = ", ".join(name for name, _ in INQUIRY_COLUMNS)
            conn.execute(
                text(f"INSERT INTO inquiries_new ({names}) VALUES ({placeholders})"),
                values,
            )
        conn.execute(text("DROP TABLE inquiries"))
        conn.execute(text("ALTER TABLE inquiries_new RENAME TO inquiries"))


def _normalize_inquiry_row(row: dict, *, convert_utc_to_local: bool) -> dict:
    result_payload = _loads_json(row.get("result"))
    input_payload = _loads_json(row.get("input_params"))
    stp_filename = row.get("stp_filename")
    part_name = (
        row.get("part_name")
        or _nested_value(result_payload, "part", "name")
        or _nested_value(input_payload, "part_name")
        or _stem(stp_filename)
    )
    record_id = row.get("record_id") or row.get("id")
    return {
        "part_name": part_name,
        "created_at": _normalize_created_at(row.get("created_at"), convert_utc_to_local=convert_utc_to_local),
        "customer_name": row.get("customer_name"),
        "customer_email": row.get("customer_email"),
        "quantity": row.get("quantity"),
        "material_name": row.get("material_name"),
        "volume_mm3": row.get("volume_mm3"),
        "weight_kg": row.get("weight_kg"),
        "max_dim_mm": row.get("max_dim_mm"),
        "tolerance_grade": row.get("tolerance_grade"),
        "total_usd": row.get("total_usd"),
        "total_display": row.get("total_display"),
        "currency": row.get("currency"),
        "batch_id": row.get("batch_id"),
        "batch_item_id": row.get("batch_item_id"),
        "batch_item_index": row.get("batch_item_index"),
        "batch_item_count": row.get("batch_item_count"),
        "stp_filename": stp_filename,
        "client_ip": row.get("client_ip"),
        "user_agent": row.get("user_agent"),
        "input_params": row.get("input_params") or "{}",
        "result": row.get("result") or "{}",
        "record_id": record_id,
    }


def _normalize_created_at(value, *, convert_utc_to_local: bool) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif value:
        raw = str(value).replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            return datetime.now().astimezone().replace(tzinfo=None)
    else:
        return datetime.now().astimezone().replace(tzinfo=None)

    if convert_utc_to_local:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone()
    return dt.replace(tzinfo=None)


def _loads_json(value) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _nested_value(data: dict, *keys: str):
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _stem(value) -> str | None:
    if not value:
        return None
    return Path(str(value)).stem or None


def shutdown_session(exception=None) -> None:
    SessionLocal.remove()
