"""Import freight data v2: zones, rate cards, and surcharges.

Preserves the old freight_rates table for backwards compatibility.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import DATA_DIR, SessionLocal, init_db
from models import FreightRateCard, FreightZone
from services.country_names import to_english
from services.freight_importer_v2 import import_v2


def import_freight_v2() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

    result = import_v2()

    session = SessionLocal()
    try:
        # ── Clear old v2 data ──
        session.query(FreightRateCard).delete()
        session.query(FreightZone).delete()

        # ── Import zones ──
        zone_objects = [
            FreightZone(
                carrier=z["carrier"],
                country=to_english(z["country_cn"]),
                country_cn=z["country_cn"],
                zone_code=z["zone_code"],
                source_sheet=z["source_sheet"],
                source_row=z["source_row"],
            )
            for z in result["zones"]
        ]
        session.bulk_save_objects(zone_objects)

        # ── Import rate cards ──
        card_objects = [
            FreightRateCard(
                carrier=rc["carrier"],
                cargo_type=rc.get("cargo_type", "package"),
                pricing_mode=rc["pricing_mode"],
                zone_code=rc["zone_code"],
                weight_min=rc["weight_min"],
                weight_max=rc["weight_max"],
                charge_weight=rc.get("charge_weight"),
                currency=rc["currency"],
                price_type=rc["price_type"],
                price=rc["price"],
                source_sheet=rc["source_sheet"],
                source_row=rc["source_row"],
            )
            for rc in result["rate_cards"]
        ]
        session.bulk_save_objects(card_objects)
        session.commit()

        report = result["report"]
        report["inserted_zones"] = len(zone_objects)
        report["inserted_rate_cards"] = len(card_objects)
        return report
    finally:
        session.close()
        SessionLocal.remove()


if __name__ == "__main__":
    report = import_freight_v2()
    print("Freight v2 import complete:")
    for k, v in report.items():
        print(f"  {k}: {v}")
