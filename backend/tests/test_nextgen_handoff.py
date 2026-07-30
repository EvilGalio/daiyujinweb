import inspect
import json
import urllib.error
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture()
def handoff_module(monkeypatch):
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    monkeypatch.setenv("QUOTE_HANDOFF_SIGNING_SECRET", "q" * 32)
    monkeypatch.setenv("NEXTGEN_LEGACY_HANDOFF_SECRET", "n" * 32)
    monkeypatch.setenv("NEXTGEN_API_BASE_URL", "http://127.0.0.1:5400/api/v2")
    monkeypatch.setenv("NEXTGEN_COMPANY_CODE", "daiyujin")
    monkeypatch.setenv(
        "NEXTGEN_CUSTOMER_PORTAL_URL",
        "https://portal.daiyujin.dpdns.org",
    )
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

    with pytest.raises(handoff_module.QuoteReferenceError):
        handoff_module.verify_quote_reference(f"{payload}.{signature}=")


def test_quote_reference_expiration(handoff_module, monkeypatch) -> None:
    monkeypatch.setattr(handoff_module.time, "time", lambda: 1_000)
    reference = handoff_module.create_quote_reference(7)
    monkeypatch.setenv("QUOTE_REFERENCE_TTL_SECONDS", "300")
    monkeypatch.setattr(handoff_module.time, "time", lambda: 1_301)

    with pytest.raises(handoff_module.QuoteReferenceError, match="expired"):
        handoff_module.verify_quote_reference(reference)


def test_file_receipt_is_signed_and_bound_to_one_file(
    handoff_module,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    receipt = handoff_module.create_file_receipt(file_id)

    assert handoff_module.verify_file_receipt(receipt) == file_id

    payload, signature = receipt.split(".", 1)
    replacement = "A" if signature[-1] != "A" else "B"
    with pytest.raises(handoff_module.QuoteReferenceError):
        handoff_module.verify_file_receipt(
            f"{payload}.{signature[:-1]}{replacement}"
        )


def test_nextgen_api_base_defaults_to_reviewed_loopback(
    handoff_module,
    monkeypatch,
) -> None:
    monkeypatch.delenv("NEXTGEN_API_BASE_URL", raising=False)

    assert (
        handoff_module._nextgen_api_base()
        == "http://127.0.0.1:5400/api/v2"
    )


@pytest.mark.parametrize(
    "configured_url",
    [
        "http://localhost:5400/api/v2",
        "http://127.0.0.1:5300/api/v2",
        "http://127.0.0.1:5400/api/v2/",
        "http://127.0.0.1:5400/api/v2/other",
        "http://127.0.0.1:5400/api/v2?target=other",
        "https://127.0.0.1:5400/api/v2",
        "https://portal.daiyujin.dpdns.org/api/v2",
        "https://attacker.example/api/v2",
    ],
)
def test_nextgen_api_base_rejects_every_unreviewed_destination(
    handoff_module,
    monkeypatch,
    configured_url: str,
) -> None:
    monkeypatch.setenv("NEXTGEN_API_BASE_URL", configured_url)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="reviewed NextGen loopback endpoint",
    ):
        handoff_module._nextgen_api_base()


def test_public_handoff_route_cannot_derive_company_from_legacy_site() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "app.py").read_text(encoding="utf-8")
    route = source.split('@app.post("/api/public/quote/handoff")', 1)[1]
    route = route.split('@app.get("/api/public/settings")', 1)[0]

    assert 'payload.get("site")' not in route
    assert 'payload.get("theme")' not in route
    assert "_site_from_request" not in route
    assert "brand_code" not in route
    assert "return_url" not in route
    assert "file_references" not in route


def _sample_inquiry(input_overrides: dict | None = None) -> SimpleNamespace:
    stored_input = {
        "file_id": "12345678-1234-5678-1234-567812345678",
        "stp_filename": "folder/part.step",
        "selections": {"process": "CNC Machining"},
    }
    stored_input.update(input_overrides or {})
    return SimpleNamespace(
        record_id=17,
        input_params=json.dumps(stored_input),
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


def _install_fake_session(
    handoff_module,
    monkeypatch,
    inquiry: SimpleNamespace | None = None,
) -> SimpleNamespace:
    inquiry = inquiry or _sample_inquiry()

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

    monkeypatch.setattr(handoff_module, "SessionLocal", FakeSessionFactory())
    return inquiry


class _FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"data": self.payload}).encode()


class _StatefulNextGen:
    def __init__(self):
        self.expected_secret = "n" * 32
        self.expected_company = "daiyujin"
        self.records: dict[str, tuple[bytes, dict]] = {}
        self.response_statuses: list[int] = []
        self.requests = []
        self.create_count = 0

    @staticmethod
    def _reject(request, status: int):
        raise urllib.error.HTTPError(
            request.full_url,
            status,
            "rejected",
            hdrs=None,
            fp=None,
        )

    def __call__(self, request, timeout):
        assert timeout == 12
        self.requests.append(request)
        if request.get_header("X-legacy-handoff-secret") != self.expected_secret:
            self._reject(request, 403)
        payload = json.loads(request.data.decode())
        if payload.get("brand_code") != self.expected_company:
            self._reject(request, 409)
        key = request.get_header("Idempotency-key")
        existing = self.records.get(key)
        if existing is not None:
            if existing[0] != request.data:
                self._reject(request, 409)
            self.response_statuses.append(200)
            return _FakeResponse(existing[1])
        handoff = {
            "sign_up_url": (
                "https://portal.daiyujin.dpdns.org/"
                f"sign-up?handoff={len(self.records) + 1}"
            ),
            "expires_at": "2026-07-14T12:00:00Z",
        }
        self.records[key] = (request.data, handoff)
        self.create_count += 1
        self.response_statuses.append(201)
        return _FakeResponse(handoff)


def test_nextgen_handoff_uses_server_side_context_and_idempotency(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    receipt = handoff_module.create_file_receipt(file_id)
    _install_fake_session(
        handoff_module,
        monkeypatch,
        _sample_inquiry({"file_receipt": receipt}),
    )
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    (upload_root / f"{file_id}_part.step").write_bytes(
        b"server-minted test upload"
    )
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    monkeypatch.setenv(
        "NEXTGEN_CUSTOMER_PORTAL_URL",
        "https://portal.daiyujin.dpdns.org",
    )
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    first = handoff_module.create_nextgen_handoff(quote_reference=reference)
    replay = handoff_module.create_nextgen_handoff(quote_reference=reference)

    request = nextgen.requests[0]
    payload = json.loads(request.data.decode())
    assert "brand_code" not in inspect.signature(
        handoff_module.create_nextgen_handoff
    ).parameters
    assert "return_url" not in inspect.signature(
        handoff_module.create_nextgen_handoff
    ).parameters
    assert payload["brand_code"] == "daiyujin"
    assert payload["brand_code"] != "mfg"
    assert "return_url" not in payload
    assert first["sign_up_url"].startswith(
        "https://portal.daiyujin.dpdns.org/"
    )
    assert replay == first
    assert (
        request.full_url
        == "http://127.0.0.1:5400/api/v2/public/handoffs"
    )
    assert request.get_header("Content-type") == "application/json"
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
    assert len(nextgen.requests) == 2
    assert nextgen.requests[1].data == request.data
    assert (
        nextgen.requests[1].get_header("Idempotency-key")
        == request.get_header("Idempotency-key")
    )
    assert nextgen.create_count == 1
    assert len(nextgen.records) == 1
    assert nextgen.response_statuses == [201, 200]


@pytest.mark.parametrize(
    ("bridge_secret", "company_code", "status_code"),
    [
        ("wrong-secret-" + "x" * 32, "daiyujin", 403),
        ("n" * 32, "mfg", 409),
    ],
)
def test_nextgen_rejects_wrong_secret_and_wrong_company(
    handoff_module,
    monkeypatch,
    bridge_secret: str,
    company_code: str,
    status_code: int,
) -> None:
    _install_fake_session(handoff_module, monkeypatch)
    monkeypatch.setenv("NEXTGEN_LEGACY_HANDOFF_SECRET", bridge_secret)
    monkeypatch.setenv("NEXTGEN_COMPANY_CODE", company_code)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match=rf"\({status_code}\)",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert len(nextgen.records) == 0


def test_browser_injected_file_references_are_not_trusted(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    inquiry = _sample_inquiry(
        {
            "file_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "file_references": [
                {
                    "file_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "original_filename": "injected.step",
                    "mime_type": "model/step",
                }
            ],
        }
    )
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)

    reference = handoff_module.create_quote_reference(17)
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    payload = json.loads(nextgen.requests[0].data.decode())
    assert payload["context"]["file_references"] == []


def test_file_receipt_cannot_be_substituted_across_inquiries(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    first_file_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    second_file_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    second_receipt = handoff_module.create_file_receipt(second_file_id)
    inquiry = _sample_inquiry(
        {
            "file_id": first_file_id,
            "file_receipt": second_receipt,
            "stp_filename": "first.step",
        }
    )
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    (upload_root / f"{first_file_id}_first.step").write_bytes(b"first")
    (upload_root / f"{second_file_id}_second.step").write_bytes(b"second")
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)

    reference = handoff_module.create_quote_reference(17)
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    payload = json.loads(nextgen.requests[0].data.decode())
    assert payload["context"]["file_references"] == []


def test_nextgen_rejects_unexpected_signup_origin(
    handoff_module,
    monkeypatch,
) -> None:
    _install_fake_session(handoff_module, monkeypatch)

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(
                {"data": {"sign_up_url": "https://attacker.example/sign-up"}}
            ).encode()

    monkeypatch.setattr(
        handoff_module.urllib.request,
        "urlopen",
        lambda _request, timeout: FakeResponse(),
    )
    reference = handoff_module.create_quote_reference(17)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="unexpected origin",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)
