"""Seed initial portal users. Run from project root."""
import secrets, sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
from database import SessionLocal
from models import PortalUser
from werkzeug.security import generate_password_hash

session = SessionLocal()
try:
    admin_pw = secrets.token_hex(8)
    existing = session.query(PortalUser).filter_by(email="admin@daiyujin.com").first()
    if not existing:
        session.add(PortalUser(
            email="admin@daiyujin.com",
            password_hash=generate_password_hash(admin_pw),
            role="admin",
            display_name="Portal Admin",
            must_change_password=True,
        ))
        print(f"Created admin@daiyujin.com / {admin_pw}")
    else:
        print("admin@daiyujin.com already exists")

    sales_pw = secrets.token_hex(8)
    existing_sales = session.query(PortalUser).filter_by(email="sales@daiyujin.com").first()
    if not existing_sales:
        session.add(PortalUser(
            email="sales@daiyujin.com",
            password_hash=generate_password_hash(sales_pw),
            role="sales",
            display_name="Sales Rep",
            must_change_password=True,
        ))
        print(f"Created sales@daiyujin.com / {sales_pw}")
    else:
        print("sales@daiyujin.com already exists")

    session.commit()
    print("Done. Please change default passwords immediately.")
finally:
    session.close()
