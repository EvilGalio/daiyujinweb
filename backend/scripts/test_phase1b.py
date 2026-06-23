from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import SessionLocal
from models import FreightRate
from scripts.import_freight_rates import import_freight_rates
from scripts.seed_data import seed
from services.freight import calculate_freight, get_countries, get_freight_summary


def main() -> int:
    seed()
    import_result = import_freight_rates()
    assert import_result["inserted"] > 9000, import_result

    countries = get_countries()
    en_names = [c["en"] for c in countries]
    assert "Germany" in en_names
    assert "Japan" in en_names

    summary = get_freight_summary()
    assert summary["record_count"] == import_result["inserted"]
    assert set(summary["carriers"]) == {"DHL", "FedEx"}

    quote = calculate_freight(
        country="Germany",
        weight_kg=5,
        carriers=["DHL", "FedEx"],
        currency="CNY",
    )
    assert len(quote["results"]) == 2, quote
    assert quote["missing_carriers"] == []
    assert all(item["billable_weight_kg"] >= 5 for item in quote["results"])

    session = SessionLocal()
    try:
        assert session.query(FreightRate).count() == import_result["inserted"]
    finally:
        session.close()
        SessionLocal.remove()

    print("phase 1B smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
