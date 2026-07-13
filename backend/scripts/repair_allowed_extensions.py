"""Enable archive upload extensions in the active application database."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

SCOPES = ["quote:default", "quote:mfg", "quote:gcindus", "quote:gcnov"]
VALUE = '["stp","step","igs","iges","zip","rar","7z"]'
DESCRIPTION = "Allowed file extensions"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        help="Override DATABASE_URL for this migration only.",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Directory for the SQLite backup. Defaults to a backups folder beside the database.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip the SQLite backup.",
    )
    return parser.parse_args()


def sqlite_database_path(database_url: str) -> Path | None:
    from sqlalchemy.engine import make_url

    url = make_url(database_url)
    if url.get_backend_name() != "sqlite":
        return None
    if not url.database or url.database == ":memory:":
        raise RuntimeError("A file-backed SQLite database is required.")
    path = Path(url.database)
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def backup_sqlite(source_path: Path, backup_dir: Path | None) -> Path:
    destination_dir = (backup_dir or source_path.parent / "backups").resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    destination = destination_dir / f"{source_path.name}.before_archive_uploads_{stamp}.bak"

    source = sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return destination


def repair(database_url: str, *, create_backup: bool, backup_dir: Path | None) -> None:
    from sqlalchemy import inspect

    from database import SessionLocal, engine
    from models import AppSetting

    database_path = sqlite_database_path(database_url)
    if database_path is not None:
        if not database_path.is_file():
            raise RuntimeError(f"Database file does not exist: {database_path}")
        print(f"Database: {database_path}")
        if create_backup:
            backup_path = backup_sqlite(database_path, backup_dir)
            print(f"Backup:   {backup_path}")
    else:
        print("Database: configured non-SQLite database")
        if create_backup:
            print("Backup:   skipped for non-SQLite database")

    if "app_settings" not in inspect(engine).get_table_names():
        raise RuntimeError("The selected database does not contain the app_settings table.")

    session = SessionLocal()
    created = 0
    updated = 0
    try:
        for scope in SCOPES:
            row = session.query(AppSetting).filter_by(scope=scope, key="allowed_extensions").first()
            if row is None:
                row = AppSetting(
                    scope=scope,
                    key="allowed_extensions",
                    value=VALUE,
                    value_type="json",
                    is_public=True,
                    description=DESCRIPTION,
                    updated_by="archive-upload-migration",
                )
                session.add(row)
                created += 1
                continue

            changed = False
            desired = {
                "value": VALUE,
                "value_type": "json",
                "is_public": True,
                "description": DESCRIPTION,
                "updated_by": "archive-upload-migration",
            }
            for field, value in desired.items():
                if getattr(row, field) != value:
                    setattr(row, field, value)
                    changed = True
            if changed:
                updated += 1

        session.commit()

        rows = session.query(AppSetting).filter(
            AppSetting.scope.in_(SCOPES),
            AppSetting.key == "allowed_extensions",
        ).all()
        values = {row.scope: row.value for row in rows}
        invalid = [scope for scope in SCOPES if values.get(scope) != VALUE]
        if invalid:
            raise RuntimeError(f"Verification failed for scopes: {', '.join(invalid)}")

        print(f"Created:  {created}")
        print(f"Updated:  {updated}")
        for scope in SCOPES:
            print(f"Verified: {scope} = {values[scope]}")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        SessionLocal.remove()


def main() -> int:
    args = parse_args()
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    try:
        from database import get_database_url

        repair(
            get_database_url(),
            create_backup=not args.no_backup,
            backup_dir=args.backup_dir,
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
