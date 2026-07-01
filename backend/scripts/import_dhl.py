"""Import DHL data from A重量运费重制版.xlsx into dhl_* tables."""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import init_db, SessionLocal
from models import DhlZone, DhlSmallRate, DhlHeavyRate, DhlConfig
from services.country_names import to_english
from services.dhl_importer import import_dhl


def import_all():
    init_db()
    result = import_dhl()

    session = SessionLocal()
    try:
        # Clear
        session.query(DhlZone).delete()
        session.query(DhlSmallRate).delete()
        session.query(DhlHeavyRate).delete()
        session.query(DhlConfig).delete()

        # Zones
        for z in result["zones"]:
            session.add(DhlZone(
                country=to_english(z["country_cn"]),
                country_cn=z["country_cn"],
                zone_code=z["zone_code"],
            ))

        # Small rates
        for sr in result["small_rates"]:
            session.add(DhlSmallRate(
                country=to_english(sr["country_cn"]),
                zone_code=sr["zone_code"],
                charge_weight=sr["charge_weight"],
                base_price_cny=sr["base_price_cny"],
            ))

        # Heavy rates
        for ht in result["heavy_tiers"]:
            for zone_text, price in ht["zones"].items():
                session.add(DhlHeavyRate(
                    tier=ht["tier"],
                    zone_text=zone_text,
                    base_unit_price_cny=price,
                ))

        # Config
        configs = [
            ("default_currency", "USD", "Default display currency"),
            ("small_multiplier", "1.8", "Small cargo multiplier"),
            ("heavy_multiplier", "1.7", "Heavy cargo multiplier"),
            ("small_weight_limit_kg", "33", "Threshold for small vs heavy path"),
        ]
        for key, val, desc in configs:
            session.add(DhlConfig(key=key, value=val, description=desc))

        session.commit()
    finally:
        session.close()
        SessionLocal.remove()

    print("DHL import complete:")
    for k, v in result["report"].items():
        if k == "config":
            print(f"  config: {v}")
        else:
            print(f"  {k}: {v}")


if __name__ == "__main__":
    import_all()
