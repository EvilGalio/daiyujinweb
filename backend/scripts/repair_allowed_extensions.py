"""Repair allowed_extensions in app_settings to include IGES & ZIP."""
import sys
sys.path.insert(0, "D:/myfirstgithubcode/daiyujinweb/backend")
from database import SessionLocal
from models import AppSetting

VAL = '["stp","step","igs","iges","zip"]'
session = SessionLocal()
updated = 0
for scope in ["quote:default", "quote:mfg", "quote:gcindus", "quote:gcnov"]:
    row = session.query(AppSetting).filter_by(scope=scope, key="allowed_extensions").first()
    if row and row.value != VAL:
        row.value = VAL
        updated += 1
session.commit()
for row in session.query(AppSetting).filter_by(key="allowed_extensions").all():
    print(f"  {row.scope}: {row.value}")
print(f"Updated {updated} rows")
session.close()
