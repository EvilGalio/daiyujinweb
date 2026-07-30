import hashlib
import inspect
import json
import urllib.error
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def handoff_module(monkeypatch, tmp_path: Path):
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

    # Keep the staged contract filename below the Win32 MAX_PATH boundary when
    # pytest's per-test directory name is itself long.
    runtime_id = hashlib.sha256(str(tmp_path).encode("utf-8")).hexdigest()[:8]
    runtime_backend = tmp_path.parent / f"b-{runtime_id}"
    runtime_uploads = runtime_backend / "uploads"
    runtime_uploads.mkdir(parents=True)
    monkeypatch.setattr(module, "BACKEND_ROOT", runtime_backend)
    monkeypatch.setattr(module, "LEGACY_UPLOAD_ROOT", runtime_uploads)
    monkeypatch.setenv(
        "NEXTGEN_HANDOFF_STAGING_ROOT",
        str(runtime_backend / "private" / "nextgen_handoff"),
    )
    monkeypatch.setenv(
        "QUOTE_JOB_STORAGE_ROOT",
        str(runtime_uploads / "quote-jobs"),
    )
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
        " http://127.0.0.1:5400/api/v2",
        "http://127.0.0.1:5400/api/v2 ",
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


@pytest.mark.parametrize(
    "company_code",
    ["mfg", "Daiyujin", "daiyujin-public-pilot", "daiyujin "],
)
def test_nextgen_company_is_exact_server_side_configuration(
    handoff_module,
    monkeypatch,
    company_code: str,
) -> None:
    monkeypatch.setenv("NEXTGEN_COMPANY_CODE", company_code)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="reviewed public-pilot company",
    ):
        handoff_module._nextgen_company_code()


@pytest.mark.parametrize(
    "portal_url",
    [
        "https://portal.daiyujin.dpdns.org/",
        "http://portal.daiyujin.dpdns.org",
        "https://portal.daiyujin.dpdns.org.evil.example",
        "https://portal.daiyujin.dpdns.org/sign-up",
        "https://portal.daiyujin-ai.com",
        " https://portal.daiyujin.dpdns.org",
    ],
)
def test_customer_portal_configuration_is_exact(
    handoff_module,
    monkeypatch,
    portal_url: str,
) -> None:
    monkeypatch.setenv("NEXTGEN_CUSTOMER_PORTAL_URL", portal_url)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="reviewed public Portal",
    ):
        handoff_module._expected_portal_origin()


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
                    "material": {
                        "id": "AL-6061",
                        "name": "6061",
                        "density_g_cm3": 2.7,
                        "price_rmb_per_kg": 99.25,
                    },
                    "material_category": "aluminum",
                    "process": "CNC Machining",
                    "postprocess_group": "As machined",
                    "quantity": 25,
                    "tolerance_grade": "ISO 2768-m",
                },
                "formula": {"internal_margin": 1.85},
                "warnings": ["internal-cost-warning"],
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


def test_handoff_context_never_stringifies_nested_selection_objects(
    handoff_module,
) -> None:
    inquiry = _sample_inquiry()
    stored_result = json.loads(inquiry.result)
    stored_result["selections"]["material"]["name"] = {
        "label": "do-not-stringify",
        "price_rmb_per_kg": 99.25,
    }
    stored_result["selections"]["process"] = {
        "label": "do-not-stringify",
        "internal_margin": 1.85,
    }
    stored_result["selections"]["postprocess_group"] = [
        "do-not-stringify",
    ]
    inquiry.result = json.dumps(stored_result)

    context = handoff_module._handoff_context(inquiry)
    serialized = json.dumps(context)

    assert context["material"] == "AL-6061"
    assert context["process"] == ""
    assert context["finish"] == ""
    assert "do-not-stringify" not in serialized
    assert "price_rmb_per_kg" not in serialized
    assert "internal_margin" not in serialized


def _install_fake_session(
    handoff_module,
    monkeypatch,
    inquiry: SimpleNamespace | None = None,
) -> SimpleNamespace:
    inquiry = inquiry or _sample_inquiry()

    class FakeSession:
        commit_count = 0

        def get(self, _model, record_id):
            assert record_id == 17
            return inquiry

        def commit(self):
            self.commit_count += 1

        def rollback(self):
            return None

        def expire_all(self):
            return None

        def close(self):
            return None

    class FakeSessionFactory:
        def __call__(self):
            return FakeSession()

        def remove(self):
            return None

    monkeypatch.setattr(handoff_module, "SessionLocal", FakeSessionFactory())

    def compare_and_set(
        _session,
        *,
        inquiry_id: int,
        expected_input: str,
        replacement_input: str,
    ) -> bool:
        assert inquiry_id == inquiry.record_id
        if inquiry.input_params != expected_input:
            return False
        inquiry.input_params = replacement_input
        return True

    monkeypatch.setattr(
        handoff_module,
        "_compare_and_set_handoff_input",
        compare_and_set,
    )
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
        if {
            "brand",
            "brand_code",
            "company",
            "company_code",
            "return_url",
            "site",
            "theme",
        } & payload.keys():
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


def test_snapshot_compare_and_set_updates_only_the_expected_input_column(
    handoff_module,
) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    handoff_module.Inquiry.__table__.create(engine)
    session_factory = sessionmaker(bind=engine, future=True)
    try:
        with session_factory() as session:
            session.add(
                handoff_module.Inquiry(
                    record_id=17,
                    part_name="Preserve this field",
                    input_params="{}",
                    result="{}",
                )
            )
            session.commit()

        with session_factory() as session:
            assert handoff_module._compare_and_set_handoff_input(
                session,
                inquiry_id=17,
                expected_input="{}",
                replacement_input='{"winner":true}',
            )
            session.commit()

        with session_factory() as session:
            assert not handoff_module._compare_and_set_handoff_input(
                session,
                inquiry_id=17,
                expected_input="{}",
                replacement_input='{"loser":true}',
            )
            session.rollback()
            stored = session.get(handoff_module.Inquiry, 17)
            assert stored is not None
            assert stored.input_params == '{"winner":true}'
            assert stored.part_name == "Preserve this field"
    finally:
        engine.dispose()


def test_concurrent_snapshot_cas_loser_uses_the_database_winner(
    handoff_module,
    monkeypatch,
) -> None:
    inquiry = _sample_inquiry()
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    winner_payload = handoff_module._build_handoff_payload(inquiry)
    winner_payload["context"]["title"] = "Concurrent winner"
    winner_payload["context"]["part_name"] = "Concurrent winner"
    winner_payload = handoff_module._validate_snapshot_payload(
        winner_payload,
        inquiry_id=17,
    )
    winner_input = json.loads(inquiry.input_params)
    winner_input[handoff_module.HANDOFF_SNAPSHOT_KEY] = {
        "version": handoff_module.HANDOFF_SNAPSHOT_VERSION,
        "payload": winner_payload,
        "signature": handoff_module._b64encode(
            handoff_module._snapshot_signature(winner_payload)
        ),
    }
    winner_input_text = json.dumps(
        winner_input,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    cas_attempts = 0

    def lose_compare_and_set(
        _session,
        *,
        inquiry_id: int,
        expected_input: str,
        replacement_input: str,
    ) -> bool:
        nonlocal cas_attempts
        del replacement_input
        assert inquiry_id == 17
        assert inquiry.input_params == expected_input
        cas_attempts += 1
        inquiry.input_params = winner_input_text
        return False

    monkeypatch.setattr(
        handoff_module,
        "_compare_and_set_handoff_input",
        lose_compare_and_set,
    )
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)

    reference = handoff_module.create_quote_reference(17)
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert cas_attempts == 1
    assert json.loads(nextgen.requests[0].data.decode()) == winner_payload
    assert b"Concurrent winner" in nextgen.requests[0].data


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
    source_bytes = b"server-minted test upload"
    (upload_root / f"{file_id}_part.step").write_bytes(source_bytes)
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
    assert not {
        "brand",
        "brand_code",
        "company",
        "company_code",
        "return_url",
        "site",
        "theme",
    } & payload.keys()
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
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    staged_filename = f"{file_id}_{source_sha256}.step"
    assert payload["context"]["file_references"] == [
        {
            "file_id": "12345678-1234-5678-1234-567812345678",
            "original_filename": "part.step",
            "mime_type": "model/step",
            "staged_filename": staged_filename,
            "sha256": source_sha256,
            "size_bytes": len(source_bytes),
        }
    ]
    staging_root = Path(handoff_module.os.environ["NEXTGEN_HANDOFF_STAGING_ROOT"])
    assert (staging_root / staged_filename).read_bytes() == source_bytes
    assert payload["context"]["estimate_min"] == 125.5
    assert payload["context"]["material"] == "6061"
    assert payload["context"]["selections"] == {
        "material": "6061",
        "material_category": "aluminum",
        "process": "CNC Machining",
        "postprocess_group": "As machined",
        "quantity": 25,
        "tolerance_grade": "ISO 2768-m",
    }
    assert payload["context"]["warnings"] == []
    serialized_payload = request.data.decode()
    assert "price_rmb_per_kg" not in serialized_payload
    assert "density_g_cm3" not in serialized_payload
    assert "internal_margin" not in serialized_payload
    assert "internal-cost-warning" not in serialized_payload
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


def test_idempotent_replay_uses_frozen_payload_after_receipt_and_file_expire(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    monkeypatch.setenv("QUOTE_FILE_RECEIPT_TTL_SECONDS", "300")
    monkeypatch.setenv("QUOTE_REFERENCE_TTL_SECONDS", "7200")
    monkeypatch.setattr(handoff_module.time, "time", lambda: 1_000)
    receipt = handoff_module.create_file_receipt(file_id)
    inquiry = _sample_inquiry({"file_receipt": receipt})
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    uploaded = upload_root / f"{file_id}_part.step"
    uploaded.write_bytes(b"server-minted test upload")
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    first = handoff_module.create_nextgen_handoff(quote_reference=reference)
    first_body = nextgen.requests[0].data
    frozen_input = json.loads(inquiry.input_params)
    snapshot = frozen_input[handoff_module.HANDOFF_SNAPSHOT_KEY]
    assert snapshot["version"] == handoff_module.HANDOFF_SNAPSHOT_VERSION
    reference_payload = snapshot["payload"]["context"]["file_references"][0]
    staged_path = (
        Path(handoff_module.os.environ["NEXTGEN_HANDOFF_STAGING_ROOT"])
        / reference_payload["staged_filename"]
    )
    assert staged_path.read_bytes() == b"server-minted test upload"
    assert reference_payload["sha256"] == hashlib.sha256(
        staged_path.read_bytes()
    ).hexdigest()
    assert reference_payload["size_bytes"] == staged_path.stat().st_size

    uploaded.unlink()
    monkeypatch.setattr(handoff_module.time, "time", lambda: 1_401)
    replay = handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert replay == first
    assert nextgen.requests[1].data == first_body
    assert nextgen.create_count == 1
    assert nextgen.response_statuses == [201, 200]


def test_idempotent_replay_uses_staged_bytes_after_source_mutation(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    receipt = handoff_module.create_file_receipt(file_id)
    inquiry = _sample_inquiry({"file_receipt": receipt})
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    original_bytes = b"verified original CAD bytes"
    uploaded = upload_root / f"{file_id}_part.step"
    uploaded.write_bytes(original_bytes)
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    handoff_module.create_nextgen_handoff(quote_reference=reference)
    first_body = nextgen.requests[0].data
    frozen = json.loads(inquiry.input_params)
    file_reference = frozen[handoff_module.HANDOFF_SNAPSHOT_KEY]["payload"][
        "context"
    ]["file_references"][0]
    staged_path = (
        Path(handoff_module.os.environ["NEXTGEN_HANDOFF_STAGING_ROOT"])
        / file_reference["staged_filename"]
    )

    uploaded.write_bytes(b"mutated after snapshot")
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert nextgen.requests[1].data == first_body
    assert staged_path.read_bytes() == original_bytes
    assert file_reference["sha256"] == hashlib.sha256(original_bytes).hexdigest()
    assert file_reference["size_bytes"] == len(original_bytes)


def test_tampered_frozen_handoff_snapshot_fails_before_network(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    receipt = handoff_module.create_file_receipt(file_id)
    inquiry = _sample_inquiry({"file_receipt": receipt})
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    (upload_root / f"{file_id}_part.step").write_bytes(b"safe")
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    stored = json.loads(inquiry.input_params)
    stored[handoff_module.HANDOFF_SNAPSHOT_KEY]["payload"]["contact_email"] = (
        "attacker@example.test"
    )
    inquiry.input_params = json.dumps(stored)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="snapshot is invalid",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert len(nextgen.requests) == 1


def test_signed_snapshot_cannot_expand_the_nested_public_schema(
    handoff_module,
    monkeypatch,
) -> None:
    inquiry = _sample_inquiry()
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    stored = json.loads(inquiry.input_params)
    snapshot = stored[handoff_module.HANDOFF_SNAPSHOT_KEY]
    snapshot["payload"]["context"]["selections"]["price_rmb_per_kg"] = 99.25
    snapshot["signature"] = handoff_module._b64encode(
        handoff_module._snapshot_signature(snapshot["payload"])
    )
    inquiry.input_params = json.dumps(stored)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="snapshot is invalid",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert len(nextgen.requests) == 1


def test_nextgen_rejects_wrong_bridge_secret(
    handoff_module,
    monkeypatch,
) -> None:
    _install_fake_session(handoff_module, monkeypatch)
    monkeypatch.setenv("NEXTGEN_LEGACY_HANDOFF_SECRET", "wrong-secret-" + "x" * 32)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match=r"\(403\)",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert len(nextgen.records) == 0


def test_nextgen_rejects_wrong_company_before_network(
    handoff_module,
    monkeypatch,
) -> None:
    _install_fake_session(handoff_module, monkeypatch)
    monkeypatch.setenv("NEXTGEN_COMPANY_CODE", "mfg")
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="reviewed public-pilot company",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert nextgen.requests == []


def test_nextgen_rejects_wrong_portal_before_network(
    handoff_module,
    monkeypatch,
) -> None:
    _install_fake_session(handoff_module, monkeypatch)
    monkeypatch.setenv(
        "NEXTGEN_CUSTOMER_PORTAL_URL",
        "https://attacker.example",
    )
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="reviewed public Portal",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert nextgen.requests == []


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


def test_cad_staging_rejects_files_over_the_private_import_limit(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    receipt = handoff_module.create_file_receipt(file_id)
    inquiry = _sample_inquiry({"file_receipt": receipt})
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    (upload_root / f"{file_id}_part.step").write_bytes(b"12345")
    monkeypatch.setattr(handoff_module, "LEGACY_UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(handoff_module, "MAX_HANDOFF_CAD_SIZE_BYTES", 4)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)
    reference = handoff_module.create_quote_reference(17)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="exceeds the handoff size limit",
    ):
        handoff_module.create_nextgen_handoff(quote_reference=reference)

    assert nextgen.requests == []
    staging_root = Path(handoff_module.os.environ["NEXTGEN_HANDOFF_STAGING_ROOT"])
    assert list(staging_root.iterdir()) == []


def test_handoff_staging_root_must_match_the_reviewed_backend_path(
    handoff_module,
    monkeypatch,
) -> None:
    monkeypatch.setenv(
        "NEXTGEN_HANDOFF_STAGING_ROOT",
        str(handoff_module.BACKEND_ROOT / "private" / "other"),
    )

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="must use the reviewed staging path",
    ):
        handoff_module._configured_handoff_staging_root()


def test_handoff_staging_root_rejects_reparse_ancestor(
    handoff_module,
    monkeypatch,
    tmp_path: Path,
) -> None:
    backend_root = tmp_path / "backend"
    backend_root.mkdir()
    monkeypatch.setattr(handoff_module, "BACKEND_ROOT", backend_root)
    monkeypatch.setenv(
        "NEXTGEN_HANDOFF_STAGING_ROOT",
        str(backend_root / "private" / "nextgen_handoff"),
    )
    real_stat = handoff_module.os.stat
    reparse_path = handoff_module._lexical_absolute(backend_root / "private")

    def stat_with_reparse(path, *args, **kwargs):
        metadata = real_stat(path, *args, **kwargs)
        candidate = handoff_module._lexical_absolute(Path(path))
        if handoff_module.os.path.normcase(str(candidate)) == (
            handoff_module.os.path.normcase(str(reparse_path))
        ):
            return SimpleNamespace(
                st_mode=metadata.st_mode,
                st_file_attributes=handoff_module.FILE_ATTRIBUTE_REPARSE_POINT,
            )
        return metadata

    monkeypatch.setattr(handoff_module.os, "stat", stat_with_reparse)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="must not traverse reparse points",
    ):
        handoff_module._configured_handoff_staging_root()

    assert not (backend_root / "private" / "nextgen_handoff").exists()


def test_existing_wrong_content_staged_object_is_not_overwritten_or_removed(
    handoff_module,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    source_root = handoff_module.LEGACY_UPLOAD_ROOT
    source = source_root / f"{file_id}_part.step"
    source_bytes = b"reviewed source"
    source.write_bytes(source_bytes)
    sha256 = hashlib.sha256(source_bytes).hexdigest()
    staging_root = handoff_module._configured_handoff_staging_root()
    staged = staging_root / f"{file_id}_{sha256}.step"
    wrong_bytes = b"wrong pre-existing bytes"
    staged.write_bytes(wrong_bytes)

    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="does not match its verified source",
    ):
        handoff_module._stage_verified_cad(
            source,
            source_root=source_root,
            file_id=file_id,
            original_filename="part.step",
            suffix=".step",
        )

    assert staged.read_bytes() == wrong_bytes
    assert not list(staging_root.glob(".handoff-*.tmp"))


def test_snapshot_file_reference_enforces_exact_size_contract(
    handoff_module,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    sha256 = "a" * 64
    reference = {
        "file_id": file_id,
        "original_filename": "part.step",
        "mime_type": "model/step",
        "staged_filename": f"{file_id}_{sha256}.step",
        "sha256": sha256,
        "size_bytes": handoff_module.MAX_HANDOFF_CAD_SIZE_BYTES,
    }

    assert handoff_module._valid_snapshot_file_reference(reference)
    assert not handoff_module._valid_snapshot_file_reference(
        {**reference, "size_bytes": True}
    )
    assert not handoff_module._valid_snapshot_file_reference(
        {
            **reference,
            "size_bytes": handoff_module.MAX_HANDOFF_CAD_SIZE_BYTES + 1,
        }
    )


def test_post_publish_verification_failure_never_removes_shared_staged_object(
    handoff_module,
    monkeypatch,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    source_root = handoff_module.LEGACY_UPLOAD_ROOT
    source = source_root / f"{file_id}_part.step"
    source_bytes = b"content-addressed CAD"
    source.write_bytes(source_bytes)
    real_digest = handoff_module._stable_staged_digest
    digest_calls = 0

    def fail_after_publication(path: Path, *, root: Path) -> tuple[str, int]:
        nonlocal digest_calls
        digest_calls += 1
        if digest_calls == 2:
            raise handoff_module.QuoteBridgeUnavailable(
                "injected post-publication verification failure"
            )
        return real_digest(path, root=root)

    monkeypatch.setattr(
        handoff_module,
        "_stable_staged_digest",
        fail_after_publication,
    )
    with pytest.raises(
        handoff_module.QuoteBridgeUnavailable,
        match="injected post-publication verification failure",
    ):
        handoff_module._stage_verified_cad(
            source,
            source_root=source_root,
            file_id=file_id,
            original_filename="part.step",
            suffix=".step",
        )

    sha256 = hashlib.sha256(source_bytes).hexdigest()
    staged = (
        Path(handoff_module.os.environ["NEXTGEN_HANDOFF_STAGING_ROOT"])
        / f"{file_id}_{sha256}.step"
    )
    assert staged.read_bytes() == source_bytes
    assert not list(staged.parent.glob(".handoff-*.tmp"))


def test_async_nested_cad_is_frozen_into_the_immediate_staging_root(
    handoff_module,
    monkeypatch,
) -> None:
    file_id = "12345678-1234-5678-1234-567812345678"
    receipt = handoff_module.create_file_receipt(file_id)
    inquiry = _sample_inquiry(
        {
            "file_receipt": receipt,
            "stp_filename": "nested-part.step",
        }
    )
    inquiry.stp_filename = "nested-part.step"
    _install_fake_session(handoff_module, monkeypatch, inquiry)
    quote_job_root = Path(
        handoff_module.os.environ["QUOTE_JOB_STORAGE_ROOT"]
    )
    nested_source = (
        quote_job_root
        / "job-1"
        / "parts"
        / f"{file_id}_nested-part.step"
    )
    nested_source.parent.mkdir(parents=True)
    source_bytes = b"verified async CAD bytes"
    nested_source.write_bytes(source_bytes)
    nextgen = _StatefulNextGen()
    monkeypatch.setattr(handoff_module.urllib.request, "urlopen", nextgen)

    reference = handoff_module.create_quote_reference(17)
    handoff_module.create_nextgen_handoff(quote_reference=reference)

    payload = json.loads(nextgen.requests[0].data.decode())
    file_reference = payload["context"]["file_references"][0]
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    assert file_reference == {
        "file_id": file_id,
        "original_filename": "nested-part.step",
        "mime_type": "model/step",
        "staged_filename": f"{file_id}_{source_sha256}.step",
        "sha256": source_sha256,
        "size_bytes": len(source_bytes),
    }
    staged = (
        Path(handoff_module.os.environ["NEXTGEN_HANDOFF_STAGING_ROOT"])
        / file_reference["staged_filename"]
    )
    assert staged.read_bytes() == source_bytes


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
