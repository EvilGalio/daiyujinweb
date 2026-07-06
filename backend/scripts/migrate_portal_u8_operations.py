"""U8 migration — add shipping/manual_status fields, remap old stages."""
import sys, os, shutil
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from sqlalchemy import text, inspect
from database import engine


def _sqlite_db_path():
    from database import get_database_url
    url = get_database_url()
    if not url.startswith("sqlite:///"):
        return None
    return Path(url.removeprefix("sqlite:///"))

STAGE_MAP = {
    "material_purchasing": "order_confirmed",
    "material_ready": "order_confirmed",
    "in_process_qc": "quality_inspection",
    "final_inspection": "quality_inspection",
    "packing": "shipped",
    "delivered": "received",
}

STATUS_MAP = {
    "on_hold": "on_hold",
    "cancelled": "cancelled",
}


def migrate(backup=False):
    if backup:
        db_path = _sqlite_db_path()
        if db_path and db_path.exists():
            bak = db_path.with_name(db_path.name + f".u8_backup_{datetime.now():%Y%m%d_%H%M%S}")
            shutil.copy2(db_path, bak)
            print(f"Backed up to {bak}")
        else:
            print("Backup skipped: DATABASE_URL is not a local SQLite file.")

    insp = inspect(engine)
    with engine.begin() as conn:
        # 1. Add missing columns to portal_orders
        order_cols = {c["name"] for c in insp.get_columns("portal_orders")}
        for col, ddl in [
            ("shipping_method", "VARCHAR(40)"),
            ("complaint_status", "VARCHAR(40)"),
            ("complaint_opened_at", "TIMESTAMP"),
            ("complaint_resolved_at", "TIMESTAMP"),
        ]:
            if col not in order_cols:
                conn.execute(text(f"ALTER TABLE portal_orders ADD COLUMN {col} {ddl}"))
                print(f"  + portal_orders.{col}")
            else:
                print(f"  ✓ portal_orders.{col} exists")
        if "manual_status" not in order_cols:
            conn.execute(text("ALTER TABLE portal_orders ADD COLUMN manual_status VARCHAR(20) NOT NULL DEFAULT 'normal'"))
            print("  + portal_orders.manual_status")

        # 2. Add missing columns to portal_order_media
        media_cols = {c["name"] for c in insp.get_columns("portal_order_media")}
        for col, ddl in [
            ("file_kind", "VARCHAR(20) NOT NULL DEFAULT 'image'"),
            ("stage_key", "VARCHAR(40)"),
            ("download_count", "INTEGER NOT NULL DEFAULT 0"),
            ("last_downloaded_at", "TIMESTAMP"),
        ]:
            if col not in media_cols:
                conn.execute(text(f"ALTER TABLE portal_order_media ADD COLUMN {col} {ddl}"))
                print(f"  + portal_order_media.{col}")
            else:
                print(f"  ✓ portal_order_media.{col} exists")

        # 3. Stage migration
        if "current_stage" in order_cols:
            before = conn.execute(text("SELECT current_stage, COUNT(*) FROM portal_orders GROUP BY current_stage")).fetchall()
            print("\nBefore stage migration:")
            for r in before: print(f"  {r[0]}: {r[1]}")

            for old, new in STAGE_MAP.items():
                result = conn.execute(text(
                    "UPDATE portal_orders SET current_stage = :new WHERE current_stage = :old"
                ), {"new": new, "old": old})
                if result.rowcount: print(f"  Migrated {result.rowcount} '{old}' -> '{new}'")

            after = conn.execute(text("SELECT current_stage, COUNT(*) FROM portal_orders GROUP BY current_stage")).fetchall()
            print("After stage migration:")
            for r in after: print(f"  {r[0]}: {r[1]}")

        # 4. Status migration
        if "status" in order_cols:
            for old, ms in STATUS_MAP.items():
                result = conn.execute(text(
                    "UPDATE portal_orders SET manual_status = :ms WHERE status = :old AND manual_status = 'normal'"
                ), {"ms": ms, "old": old})
                if result.rowcount: print(f"  Set manual_status='{ms}' for {result.rowcount} '{old}' orders")

    print("\nU8 migration complete.")


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--backup", action="store_true")
    args = p.parse_args()
    migrate(backup=args.backup)
