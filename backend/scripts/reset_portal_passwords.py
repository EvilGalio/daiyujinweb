"""Reset portal passwords to dev defaults."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from database import SessionLocal
from models import PortalUser
from werkzeug.security import generate_password_hash

s = SessionLocal()
for email, pw in [("admin@daiyujin.com", "admin123"), ("sales@daiyujin.com", "sales123")]:
    u = s.query(PortalUser).filter_by(email=email).first()
    if u:
        u.password_hash = generate_password_hash(pw)
        u.must_change_password = False
        print(f"{email} -> {pw}")
s.commit()
s.close()
print("Done.")
