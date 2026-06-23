from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import create_app
from database import SessionLocal
from models import Inquiry
from scripts.seed_data import seed
from services.pricing import calculate_quote, get_quote_options, recalculate_weight, request_formal_quote


def main() -> int:
    seed()

    options = get_quote_options()
    assert len(options["materials"]) >= 3
    assert {"USD", "CNY", "EUR"}.issubset(set(options["currencies"]))
    assert any(item["grade"] == "IT7" for item in options["tolerance_grades"])

    material_id = options["materials"][0]["id"]
    treatment_ids = [item["id"] for item in options["surface_treatments"] if item["name"] != "None"][:1]
    payload = {
        "file_id": "unit-test-file",
        "part_name": "unit-test-part",
        "stp_filename": "unit-test-part.step",
        "volume_mm3": 12500,
        "max_dim_mm": 48,
        "material_id": material_id,
        "tolerance_grade": "IT7",
        "surface_treatment_ids": treatment_ids,
        "quantity": 100,
        "currency": "USD",
    }

    weight = recalculate_weight(payload["volume_mm3"], material_id)
    assert weight["weight_kg"] > 0

    quote = calculate_quote(payload)
    assert quote["quote_status"] == "estimated"
    assert quote["part"]["weight_kg"] == weight["weight_kg"]
    assert quote["total"]["amount"] > 0
    assert quote["total"]["currency"] == "USD"
    assert "unit_price_usd_kg" not in json.dumps(quote)
    assert "factor" not in json.dumps(quote)

    formal = request_formal_quote({"quote_result": quote})
    assert formal["status"] == "received"
    assert formal["inquiry_id"] > 0

    app = create_app()
    client = app.test_client()
    options_response = client.get("/api/public/quote/options")
    assert options_response.status_code == 200, options_response.get_json()

    quote_response = client.post("/api/public/quote/calculate", json=payload)
    assert quote_response.status_code == 200, quote_response.get_json()
    assert quote_response.get_json()["total"]["amount"] > 0

    bad_response = client.post("/api/public/quote/calculate", json={**payload, "quantity": 0})
    assert bad_response.status_code == 400
    assert bad_response.get_json()["code"] == "invalid_quote_request"

    formal_response = client.post("/api/public/quote/request-formal", json={"quote_result": quote})
    assert formal_response.status_code == 200
    assert formal_response.get_json()["status"] == "received"

    session = SessionLocal()
    try:
        assert session.query(Inquiry).filter_by(type="quote").count() >= 2
        latest = session.query(Inquiry).filter_by(type="quote").order_by(Inquiry.id.desc()).first()
        assert latest.material_name is not None
        assert latest.volume_mm3 is not None
        assert latest.weight_kg is not None
        assert latest.total_usd is not None
        assert latest.currency == "USD"
        assert session.query(Inquiry).filter_by(type="quote_formal_request").count() >= 2
    finally:
        session.close()
        SessionLocal.remove()

    print("phase 1A smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
