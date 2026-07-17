from __future__ import annotations

import json
from types import SimpleNamespace

import pytest


@pytest.fixture()
def handoff_module(monkeypatch):
    backend_root = __import__("pathlib").Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    monkeypatch.setenv("QUOTE_HANDOFF_SIGNING_SECRET", "q" * 32)
    monkeypatch.setenv("NEXTGEN_LEGACY_HANDOFF_SECRET", "n" * 32)
    monkeypatch.setenv("NEXTGEN_API_BASE_URL", "http://127.0.0.1:5300/api/v2")
    import services.nextgen_handoff as module

    return module


def test_quote_reference_round_trip_and_tamper_rejection(
    handoff_module,
) -> None:
    reference = handoff_module.create_quote_reference(42)

    assert handoff_module.verify_quote_reference(reference) == 42

    payload, signature = reference.split(".", 1)
    replacement = "A" if signature[-1] != "A" else "B"
    with pytest.raises(handoff_module.QuoteReferenceError):
        handoff_module.verify_quote_reference(f"{payload}.{signature[:-1]}{replacement}")


def test_quote_reference_expiration(handoff_module, monkeypatch) -> None:
    monkeypatch.setattr(handoff_module.time, "time", lambda: 1_000)
    reference = handoff_module.create_quote_reference(7)
    monkeypatch.setenv("QUOTE_REFERENCE_TTL_SECONDS", "300")
    monkeypatch.setattr(handoff_module.time, "time", lambda: 1_301)

    with pytest.raises(handoff_module.QuoteReferenceError, match="expired"):
        handoff_module.verify_quote_reference(reference)


def test_nextgen_handoff_uses_server_side_context_and_idempotency(
    handoff_module,
    monkeypatch,
) -> None:
    inquiry = SimpleNamespace(
        record_id=17,
        input_params=json.dumps(
            {
                "file_id": "12345678-1234-5678-1234-567812345678",
                "stp_filename": "folder/part.step",
                "selections": {"process": "CNC Machining"},
            }
        ),
        result=json.dumps(
            {
                "total_estimate": {"amount": 125.5, "currency": "USD"},
                "pricing_model_version": "v2.2",
                "selections": {
                    "material": "6061",
                    "process": "CNC Machining",
                    "quantity": 25,
                },
            }
        ),
        quantity=25,
        part_name="Drive key",
        material_name="6061",
        tolerance_grade="ISO 2768-m",
        currency="USD",
        weight_kg=0.4,
        max_dim_mm=80.0,
        volume_mm3=12_000.0,
        stp_filename="folder/part.step",
        customer_email="buyer@example.com",
    )

    class FakeSession:
        def get(self, _model, record_id):
            assert record_id == 17
            return inquiry

        def close(self):
            return None

    class FakeSessionFactory:
        def __call__(self):
            return FakeSession()

        def remove(self):
            return None

    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(
                {
                    "data": {
                        "sign_up_url": "https://portal.example/sign-up?handoff=token",
                        "expires_at": "2026-07-14T12:00:00Z",
                    }
                }
            ).encode()

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(handoff_module, "SessionLocal", FakeSessionFactory())
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", fake_urlopen)
    reference = handoff_module.create_quote_reference(17)

    result = handoff_module.create_nextgen_handoff(
        quote_reference=reference,
        brand_code="mfg",
        return_url="https://mfg-solution.com/online-quote/",
    )

    request = captured["request"]
    payload = json.loads(request.data.decode())
    assert result["sign_up_url"].startswith("https://portal.example/")
    assert captured["timeout"] == 12
    assert request.full_url.endswith("/api/v2/public/handoffs")
    assert request.get_header("Idempotency-key") == "legacy-quote-17"
    assert request.get_header("X-legacy-handoff-secret") == "n" * 32
    assert payload["source_reference"] == "legacy-quote-17"
    assert payload["context"]["file_references"] == [
        {
            "file_id": "12345678-1234-5678-1234-567812345678",
            "original_filename": "part.step",
            "mime_type": "model/step",
        }
    ]
    assert payload["context"]["estimate_min"] == 125.5
    assert payload["contact_email"] == "buyer@example.com"
