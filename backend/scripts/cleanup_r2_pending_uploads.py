"""Cleanup stale R2 pending uploads."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import OperationalError
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from services.r2_storage import delete_object, r2_enabled


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def cleanup_pending_uploads(*, max_age_hours: int = 24, dry_run: bool = False, delete_objects: bool = True) -> None:
    session = SessionLocal()
    now = _utcnow()
    threshold = now - timedelta(hours=max_age_hours)

    try:
        rows = session.execute(
            text(
                """
                SELECT id, order_id, storage_key, status
                  FROM portal_pending_uploads
                 WHERE status IN ('pending', 'failed')
                   AND expires_at < :now
                   AND created_at < :threshold
                """
            ),
            {"now": now, "threshold": threshold},
        ).all()
        if not rows:
            print("No stale pending uploads found.")
            return

        for row in rows:
            row = row._mapping
            row_id = row["id"]
            storage_key = row["storage_key"]
            print(
                f"stale pending: id={row_id} "
                f"order={row['order_id']} status={row['status']}"
            )

            if dry_run:
                continue

            if delete_objects and storage_key and r2_enabled():
                try:
                    delete_object(storage_key)
                except Exception as exc:
                    print(f"  failed to delete object key={storage_key}: {exc}")

            try:
                session.execute(
                    text(
                        """
                        UPDATE portal_pending_uploads
                           SET status='expired',
                               completed_at=NULL
                         WHERE id=:row_id
                        """
                    ),
                    {"row_id": row_id},
                )
            except Exception as exc:
                print(f"Failed to update row id={row_id}: {exc}")

        if not dry_run:
            session.commit()
            print(f"Expired {len(rows)} pending upload(s).")
    except OperationalError as exc:
        print(f"Cleanup query failed: {exc}")
        session.rollback()
        raise
    finally:
        session.close()


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Cleanup stale R2 pending uploads.")
    p.add_argument("--hours", type=int, default=24, help="Stale age threshold in hours")
    p.add_argument("--dry-run", action="store_true", help="Show pending rows that would be expired")
    p.add_argument(
        "--no-delete-objects",
        action="store_true",
        help="Only mark expired, do not delete R2 objects",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    cleanup_pending_uploads(
        max_age_hours=args.hours,
        dry_run=args.dry_run,
        delete_objects=(not args.no_delete_objects),
    )

