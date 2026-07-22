from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from werkzeug.security import check_password_hash


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import SessionLocal
from materialize_reference_data import verify_materialized_reference_data
from models import AdminUser


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-root", type=Path, required=True)
    args = parser.parse_args()
    expected = os.environ.get("PRECISION_TOOLS_ADMIN_PASSWORD", "").strip()
    if len(expected) < 24:
        raise RuntimeError("PRECISION_TOOLS_ADMIN_PASSWORD is missing or too short")
    verify_materialized_reference_data(args.reference_root, BACKEND_ROOT / "data")
    session = SessionLocal()
    try:
        admin = session.query(AdminUser).filter_by(username="admin").one_or_none()
        if admin is None:
            raise RuntimeError("Precision Tools admin was not created")
        if check_password_hash(admin.password_hash, "change-me-before-production"):
            raise RuntimeError("Precision Tools still accepts the default admin password")
        if not check_password_hash(admin.password_hash, expected):
            raise RuntimeError("Precision Tools admin does not use the generated password")
    finally:
        session.close()
        SessionLocal.remove()
    print("Precision Tools fresh-PC seed: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
