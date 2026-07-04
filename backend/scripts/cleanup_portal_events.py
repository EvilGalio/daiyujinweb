"""Cleanup old portal events. Keep at least 1,000 latest events and those newer than 90 days."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from models import PortalEvent


def cleanup(days=90, keep_min=1000):
    session = SessionLocal()
    try:
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(days=days)

        total = session.query(PortalEvent).count()
        if total <= keep_min:
            print(f"Only {total} events, below minimum {keep_min}. Nothing to clean.")
            return

        latest = session.query(PortalEvent).order_by(PortalEvent.id.desc()).offset(keep_min).first()
        if latest:
            cutoff = max(cutoff, latest.created_at)

        deleted = session.query(PortalEvent).filter(
            PortalEvent.created_at < cutoff
        ).delete(synchronize_session='fetch')

        session.commit()
        print(f"Cleaned {deleted} events older than {cutoff.isoformat()}. Remaining: approx {total - deleted}.")
    finally:
        session.close()


if __name__ == "__main__":
    cleanup()
