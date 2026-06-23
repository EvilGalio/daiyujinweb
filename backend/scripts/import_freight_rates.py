from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import DATA_DIR, SessionLocal, init_db
from models import FreightRate
from services.country_names import to_english
from services.freight_importer import find_freight_workbook, parse_freight_workbook


def import_freight_rates() -> dict[str, int]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

    workbook = find_freight_workbook(PROJECT_ROOT)
    parsed = parse_freight_workbook(workbook, include_records=True)
    records = parsed["records"]

    session = SessionLocal()
    try:
        session.query(FreightRate).delete()
        session.bulk_save_objects(
            [
                FreightRate(
                    carrier=record["carrier"],
                    country=to_english(record["country"]),
                    country_cn=record["country"],
                    zone=record["zone"],
                    currency=record["currency"],
                    weight_min=record["weight_kg"],
                    weight_max=record["weight_kg"],
                    base_price=record["price"],
                    source_sheet=record["source_sheet"],
                    source_row=record["source_row"],
                )
                for record in records
            ]
        )
        session.commit()
        return {
            "inserted": len(records),
            "countries": parsed["country_count"],
            "carriers": len(parsed["carriers"]),
        }
    finally:
        session.close()
        SessionLocal.remove()


if __name__ == "__main__":
    result = import_freight_rates()
    print(
        "freight rates imported: "
        f"{result['inserted']} rows, {result['countries']} countries, {result['carriers']} carriers"
    )
