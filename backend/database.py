from __future__ import annotations

import os
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

    columns = {col["name"] for col in inspector.get_columns("inquiries")}
    statements: list[str] = []
    if "customer_name" not in columns:
        statements.append("ALTER TABLE inquiries ADD COLUMN customer_name VARCHAR(120)")

    if statements:
        with engine.begin() as conn:
            for stmt in statements:
                conn.execute(text(stmt))


def shutdown_session(exception=None) -> None:
    SessionLocal.remove()
