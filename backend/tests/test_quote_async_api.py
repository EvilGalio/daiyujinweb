from __future__ import annotations

import base64
import hashlib
import io
import uuid
import zipfile
from pathlib import Path

import pytest

def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


@pytest.fixture()
def async_api(monkeypatch, tmp_path: Path):
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    monkeypatch.setenv("QUOTE_ASYNC_ARCHIVES_ENABLED", "1")
    monkeypatch.setenv("QUOTE_REQUIRE_WORKER_HEALTH", "1")
    monkeypatch.setenv("QUOTE_JOB_MIN_FREE_BYTES", "0")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'main.db'}")

    import app as app_module

    store = app_module.QuoteJobStore(tmp_path / "quote_jobs.db")
    store.init()
    store.heartbeat("test-worker")
    storage_root = tmp_path / "quote-storage"
    monkeypatch.setattr(app_module, "quote_job_store", store)
    monkeypatch.setattr(app_module, "QUOTE_JOB_STORAGE_ROOT", storage_root)
    monkeypatch.setattr(app_module, "QUOTE_JOB_MAINTENANCE_FILE", tmp_path / "maintenance.flag")
    return app_module, store, app_module.app.test_client()


def _credentials() -> tuple[str, str, dict[str, str]]:
    job_id = str(uuid.uuid4())
    token = base64.urlsafe_b64encode(bytes(range(32))).decode("ascii").rstrip("=")
    headers = {
        "Idempotency-Key": job_id,
        "X-Quote-Job-Token": token,
    }
    return job_id, token, headers


def _post(client, headers: dict[str, str], archive: bytes, name: str = "batch.zip"):
    return client.post(
        "/api/public/quote/analysis-jobs",
        data={"file": (io.BytesIO(archive), name), "site": "default"},
        headers=headers,
        content_type="multipart/form-data",
    )


def test_create_get_etag_and_idempotent_replay(async_api) -> None:
    app_module, store, client = async_api
    job_id, token, headers = _credentials()
    archive = _zip_bytes({"folder/a.step": b"step"})

    created = _post(client, headers, archive)
    assert created.status_code == 202
    payload = created.get_json()
    assert payload["error"] is False
    assert payload["job"]["id"] == job_id
    assert payload["job"]["status"] == "queued"
    assert payload["parts"] == []
    assert (app_module.QUOTE_JOB_STORAGE_ROOT / job_id / "source.zip").is_file()

    fetched = client.get(
        f"/api/public/quote/analysis-jobs/{job_id}",
        headers={"X-Quote-Job-Token": token},
    )
    assert fetched.status_code == 200
    etag = fetched.headers["ETag"]
    unchanged = client.get(
        f"/api/public/quote/analysis-jobs/{job_id}",
        headers={"X-Quote-Job-Token": token, "If-None-Match": etag},
    )
    assert unchanged.status_code == 304
    assert unchanged.data == b""

    duplicate = _post(client, headers, archive)
    assert duplicate.status_code == 202
    assert duplicate.get_json()["job"]["id"] == job_id
    claimed = store.claim_extraction("worker-after-upload")
    assert claimed is not None
    assert claimed["id"] == job_id
    with store._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM quote_analysis_jobs").fetchone()[0] == 1


@pytest.mark.parametrize("final_file_exists", [False, True])
def test_idempotent_replay_recovers_interrupted_upload_publication(
    async_api,
    final_file_exists: bool,
) -> None:
    app_module, store, client = async_api
    job_id, token, headers = _credentials()
    archive = _zip_bytes({"nested/a.step": b"step"})
    final_path = app_module.QUOTE_JOB_STORAGE_ROOT / job_id / "source.zip"
    if final_file_exists:
        final_path.parent.mkdir(parents=True)
        final_path.write_bytes(archive)

    pending, created = store.create_job(
        job_id=job_id,
        token=token,
        archive_sha256=hashlib.sha256(archive).hexdigest(),
        archive_size=len(archive),
        archive_suffix=".zip",
        archive_path=final_path,
        source_filename="batch.zip",
        site="default",
        client_ip_hash=f"interrupted-{job_id}",
    )
    assert created is True
    assert pending["job"]["status"] == "uploading"
    assert store.claim_extraction("premature-worker") is None

    replay = _post(client, headers, archive)
    assert replay.status_code == 202
    payload = replay.get_json()
    assert payload["job"]["status"] == "queued"
    assert final_path.read_bytes() == archive
    claimed = store.claim_extraction("recovery-worker")
    assert claimed is not None
    assert claimed["id"] == job_id
    with store._connection() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM quote_analysis_jobs WHERE id=?",
            (job_id,),
        ).fetchone()[0] == 1


def test_idempotency_conflict_and_token_authorization(async_api) -> None:
    app_module, store, client = async_api
    job_id, token, headers = _credentials()
    assert _post(client, headers, _zip_bytes({"a.step": b"a"})).status_code == 202

    conflict = _post(client, headers, _zip_bytes({"b.step": b"different"}))
    assert conflict.status_code == 409
    assert conflict.get_json()["code"] == "quote_job_conflict"

    forbidden = client.get(
        f"/api/public/quote/analysis-jobs/{job_id}",
        headers={"X-Quote-Job-Token": "wrong"},
    )
    assert forbidden.status_code == 403


def test_worker_inventory_and_part_result_are_visible_incrementally(async_api, tmp_path: Path) -> None:
    app_module, store, client = async_api
    job_id, token, headers = _credentials()
    assert _post(client, headers, _zip_bytes({"a.step": b"a", "deep/b.stp": b"b"})).status_code == 202

    job = store.claim_extraction("worker-1")
    assert job is not None
    parts = []
    for position, name in enumerate(("a.step", "deep/b.stp")):
        path = tmp_path / f"part-{position}.step"
        path.write_bytes(b"step")
        parts.append(
            {
                "id": f"part-{position}",
                "position": position,
                "source_filename": name,
                "source_format": "STEP",
                "file_id": f"file-{position}",
                "stored_path": path,
                "size": 4,
            }
        )
    store.populate_parts(job_id, "worker-1", parts)
    first = store.claim_next_part("worker-1")
    assert first is not None
    store.update_part_result(
        first["id"],
        "worker-1",
        analysis={"file_id": first["file_id"], "volume_mm3": 12.5},
    )

    response = client.get(
        f"/api/public/quote/analysis-jobs/{job_id}",
        headers={"X-Quote-Job-Token": token},
    )
    payload = response.get_json()
    assert payload["job"]["counts"]["ready"] == 1
    assert payload["job"]["counts"]["queued"] == 1
    assert payload["parts"][0]["status"] == "ready"
    assert payload["parts"][0]["analysis"]["volume_mm3"] == 12.5


def test_invalid_signature_and_unhealthy_worker_are_rejected(async_api, monkeypatch) -> None:
    app_module, store, client = async_api
    job_id, token, headers = _credentials()
    invalid = _post(client, headers, b"not-a-zip")
    assert invalid.status_code == 400
    assert invalid.get_json()["code"] == "invalid_archive_upload"

    stale_store = app_module.QuoteJobStore(app_module.QUOTE_JOB_STORAGE_ROOT.parent / "stale.db")
    stale_store.init()
    monkeypatch.setattr(app_module, "quote_job_store", stale_store)
    other_id, other_token, other_headers = _credentials()
    unavailable = _post(client, other_headers, _zip_bytes({"a.step": b"a"}))
    assert unavailable.status_code == 503
    assert unavailable.get_json()["code"] == "quote_worker_unavailable"
    assert unavailable.headers["Retry-After"] == "15"


def test_request_limit_rejects_async_and_legacy_uploads_before_multipart_parsing(
    async_api,
    monkeypatch,
) -> None:
    app_module, store, client = async_api
    assert app_module.app.config["MAX_CONTENT_LENGTH"] >= (
        app_module.MAX_PORTAL_ATTACHMENT_BYTES + app_module.MAX_MULTIPART_OVERHEAD_BYTES
    )
    job_id, token, headers = _credentials()
    monkeypatch.setattr(
        app_module,
        "_save_quote_archive",
        lambda *args, **kwargs: pytest.fail("streaming save must not run"),
    )
    oversized_length = str(app_module.MAX_QUOTE_UPLOAD_REQUEST_BYTES + 1)

    async_response = client.post(
        "/api/public/quote/analysis-jobs",
        data={"file": (io.BytesIO(b"PK\x05\x06"), "batch.zip")},
        headers=headers,
        content_type="multipart/form-data",
        environ_overrides={"CONTENT_LENGTH": oversized_length},
    )
    legacy_response = client.post(
        "/api/public/quote/upload",
        data={"file": (io.BytesIO(b"step"), "part.step")},
        content_type="multipart/form-data",
        environ_overrides={"CONTENT_LENGTH": oversized_length},
    )

    for response in (async_response, legacy_response):
        assert response.status_code == 413
        assert response.get_json()["code"] == "file_too_large"

    portal_sized_length = str(
        app_module.MAX_PORTAL_ATTACHMENT_BYTES
        + app_module.MAX_MULTIPART_OVERHEAD_BYTES // 2
    )
    portal_response = client.post(
        "/api/portal/sales/orders/1/media",
        data={"file": (io.BytesIO(b"video"), "process.mp4")},
        content_type="multipart/form-data",
        environ_overrides={"CONTENT_LENGTH": portal_sized_length},
    )
    assert portal_response.status_code != 413


def test_streaming_archive_guard_still_enforces_exact_file_limit(async_api, monkeypatch) -> None:
    app_module, store, client = async_api

    class OversizedStream:
        def __init__(self):
            self.remaining = app_module.MAX_ARCHIVE_BYTES + 1

        def read(self, size: int) -> bytes:
            chunk_size = min(size, self.remaining)
            self.remaining -= chunk_size
            return b"x" * chunk_size

    uploaded = type("Upload", (), {"stream": OversizedStream()})()
    with pytest.raises(app_module.UploadTooLargeError, match="limited to 50 MB"):
        app_module._save_quote_archive(uploaded, str(uuid.uuid4()), ".zip")
    assert not list((app_module.QUOTE_JOB_STORAGE_ROOT / ".staging").glob("*.part"))

    direct_upload_root = app_module.QUOTE_JOB_STORAGE_ROOT.parent / "legacy-uploads"
    monkeypatch.setattr(app_module, "UPLOAD_DIR", direct_upload_root)
    app_module.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    direct_upload = type(
        "DirectUpload",
        (),
        {"stream": OversizedStream(), "filename": "oversized.step"},
    )()
    with pytest.raises(app_module.UploadTooLargeError, match="limited to 50 MB"):
        app_module._save_direct_cad(direct_upload, ".step")
    assert not list(app_module.UPLOAD_DIR.glob("*_oversized.step"))


def test_async_actual_byte_overflow_maps_to_413(async_api, monkeypatch) -> None:
    app_module, store, client = async_api

    def reject_stream(*args, **kwargs):
        raise app_module.UploadTooLargeError("Archive uploads are limited to 50 MB.")

    monkeypatch.setattr(app_module, "_save_quote_archive", reject_stream)
    job_id, token, headers = _credentials()
    response = _post(client, headers, _zip_bytes({"a.step": b"step"}))

    assert response.status_code == 413
    assert response.get_json()["code"] == "file_too_large"


def test_maintenance_gate_rejects_new_job_without_touching_queue(async_api) -> None:
    app_module, store, client = async_api
    app_module.QUOTE_JOB_MAINTENANCE_FILE.parent.mkdir(parents=True, exist_ok=True)
    app_module.QUOTE_JOB_MAINTENANCE_FILE.write_text("maintenance", encoding="utf-8")
    job_id, token, headers = _credentials()

    response = _post(client, headers, _zip_bytes({"a.step": b"step"}))

    assert response.status_code == 503
    assert response.get_json()["code"] == "quote_analysis_maintenance"
    assert response.headers["Retry-After"] == "30"
    with store._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM quote_analysis_jobs").fetchone()[0] == 0
    assert not (app_module.QUOTE_JOB_STORAGE_ROOT / job_id).exists()


def test_disabled_async_feature_skips_store_init_and_health_access(
    async_api,
    monkeypatch,
) -> None:
    app_module, store, client = async_api

    class DisabledStore:
        def init(self):
            raise AssertionError("disabled async store must not initialize")

        def worker_health(self):
            raise AssertionError("disabled health must not access async store")

    monkeypatch.setenv("QUOTE_ASYNC_ARCHIVES_ENABLED", "0")
    monkeypatch.setattr(app_module, "quote_job_store", DisabledStore())
    monkeypatch.setattr(app_module, "_refresh_exchange_rates_if_stale", lambda: None)
    disabled_app = app_module.create_app()
    disabled_client = disabled_app.test_client()

    health = disabled_client.get("/api/health")
    worker = health.get_json()["quote_worker"]
    assert health.status_code == 200
    assert worker == {
        "enabled": False,
        "status": "disabled",
        "last_heartbeat_at": None,
        "active_parts": 0,
        "queued_parts": 0,
    }
    _job_id, _token, headers = _credentials()
    rejected = _post(disabled_client, headers, _zip_bytes({"a.step": b"step"}))
    assert rejected.status_code == 503
    assert rejected.get_json()["code"] == "async_archives_disabled"


def test_soft_rollback_keeps_existing_job_status_cancel_and_retry_available(
    async_api,
    monkeypatch,
    tmp_path: Path,
) -> None:
    app_module, store, client = async_api
    failed_job_id, failed_token, failed_headers = _credentials()
    archive = _zip_bytes({"nested/part.step": b"step"})
    assert _post(client, failed_headers, archive).status_code == 202

    worker_id = "rollback-worker"
    claimed = store.claim_extraction(worker_id)
    assert claimed is not None
    part_id = str(uuid.uuid4())
    file_id = str(uuid.uuid4())
    part_path = tmp_path / "rollback-part.step"
    part_path.write_bytes(b"step")
    store.populate_parts(
        failed_job_id,
        worker_id,
        [
            {
                "id": part_id,
                "position": 0,
                "source_filename": "nested/part.step",
                "source_format": "STEP",
                "file_id": file_id,
                "stored_path": part_path,
                "size": 4,
            }
        ],
    )
    running = store.claim_next_part(worker_id)
    assert running is not None
    failed = store.update_part_result(
        running["id"],
        worker_id,
        error_code="cad_process_failed",
        error="Temporary CAD failure.",
    )
    assert failed["job"]["status"] == "failed"

    cancel_job_id, cancel_token, cancel_headers = _credentials()
    assert _post(client, cancel_headers, archive).status_code == 202
    monkeypatch.setenv("QUOTE_ASYNC_ARCHIVES_ENABLED", "0")

    existing = client.get(
        f"/api/public/quote/analysis-jobs/{failed_job_id}",
        headers={"X-Quote-Job-Token": failed_token},
    )
    assert existing.status_code == 200
    assert existing.get_json()["job"]["status"] == "failed"

    retried = client.post(
        f"/api/public/quote/analysis-jobs/{failed_job_id}/parts/{part_id}/retry",
        headers={"X-Quote-Job-Token": failed_token},
    )
    assert retried.status_code == 200
    assert retried.get_json()["parts"][0]["status"] == "queued"

    cancelled = client.post(
        f"/api/public/quote/analysis-jobs/{cancel_job_id}/cancel",
        headers={"X-Quote-Job-Token": cancel_token},
    )
    assert cancelled.status_code == 200
    assert cancelled.get_json()["job"]["status"] == "cancelled"

    _new_job_id, _new_token, new_headers = _credentials()
    rejected = _post(client, new_headers, archive)
    assert rejected.status_code == 503
    assert rejected.get_json()["code"] == "async_archives_disabled"


def test_cors_exposes_polling_headers(async_api) -> None:
    app_module, store, client = async_api
    response = client.options(
        "/api/public/quote/analysis-jobs",
        headers={
            "Origin": "https://mfg-solution.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Idempotency-Key, X-Quote-Job-Token, If-None-Match",
        },
    )
    assert response.status_code == 200
    allowed = response.headers.get("Access-Control-Allow-Headers", "").lower()
    assert "idempotency-key" in allowed
    assert "x-quote-job-token" in allowed
    assert "authorization" in allowed
    exposed = response.headers.get("Access-Control-Expose-Headers", "").lower()
    assert "etag" in exposed
    assert "retry-after" in exposed


def test_quote_options_exposes_async_archive_capability(async_api, monkeypatch, tmp_path: Path) -> None:
    app_module, store, client = async_api
    available = client.get("/api/public/quote/options")
    assert available.status_code == 200
    assert available.get_json()["async_archive_analysis"] is True

    monkeypatch.setenv("QUOTE_ASYNC_ARCHIVES_ENABLED", "0")
    disabled = client.get("/api/public/quote/options")
    assert disabled.get_json()["async_archive_analysis"] is False

    monkeypatch.setenv("QUOTE_ASYNC_ARCHIVES_ENABLED", "1")
    unavailable_store = app_module.QuoteJobStore(tmp_path / "unavailable-options.db")
    unavailable_store.init()
    monkeypatch.setattr(app_module, "quote_job_store", unavailable_store)
    still_enabled = client.get("/api/public/quote/options")
    assert still_enabled.get_json()["async_archive_analysis"] is True


def test_async_part_is_found_by_model_lookup(async_api) -> None:
    app_module, store, client = async_api
    file_id = str(uuid.uuid4())
    cad_path = app_module.QUOTE_JOB_STORAGE_ROOT / str(uuid.uuid4()) / "parts" / f"{file_id}_nested-part.step"
    cad_path.parent.mkdir(parents=True)
    cad_path.write_bytes(b"step")

    assert app_module._find_uploaded_cad(file_id) == cad_path
    assert app_module._find_uploaded_cad("not-a-uuid") is None
