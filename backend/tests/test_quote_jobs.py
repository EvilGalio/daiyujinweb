from __future__ import annotations

import os
import sqlite3
import time
import uuid
from pathlib import Path

import pytest

from backend.services import quote_jobs as quote_jobs_module
from backend.services.quote_jobs import (
    QuoteJobConflict,
    QuoteJobInvalidState,
    QuoteJobStore,
    QuoteJobUnauthorized,
)


def _store(tmp_path: Path) -> QuoteJobStore:
    store = QuoteJobStore(tmp_path / "quote_jobs.db")
    store.init()
    return store


def _create_job(store: QuoteJobStore, tmp_path: Path, job_id: str = "job-1", token: str = "token-1"):
    archive_path = tmp_path / job_id / "source.zip"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_bytes(b"archive")
    snapshot, created = store.create_job(
        job_id=job_id,
        token=token,
        archive_sha256="abc123",
        archive_size=7,
        archive_suffix=".zip",
        archive_path=archive_path,
        source_filename="batch.zip",
        site="default",
        client_ip_hash=f"client-{job_id}",
    )
    if created:
        snapshot = store.activate_job(job_id, token)
    return snapshot, created


def _populate_two_parts(store: QuoteJobStore, tmp_path: Path, worker_id: str = "worker-1"):
    job = store.claim_extraction(worker_id)
    assert job is not None
    parts = []
    for position in range(2):
        path = tmp_path / job["id"] / f"part-{position}.step"
        path.write_bytes(b"step")
        parts.append(
            {
                "id": f"part-{position}",
                "position": position,
                "source_filename": f"folder/part-{position}.step",
                "source_format": "STEP",
                "file_id": f"file-{position}",
                "stored_path": path,
                "size": 4,
            }
        )
    return store.populate_parts(job["id"], worker_id, parts, ["notice"])


def test_quote_job_store_enables_wal_and_idempotency(tmp_path: Path) -> None:
    store = _store(tmp_path)
    first, created = _create_job(store, tmp_path)
    second, duplicate_created = _create_job(store, tmp_path)

    assert created is True
    assert duplicate_created is False
    assert second["job"]["id"] == first["job"]["id"]
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    with store._connection() as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1

    with pytest.raises(QuoteJobUnauthorized):
        store.get_snapshot("job-1", "wrong-token")
    with pytest.raises(QuoteJobConflict):
        store.create_job(
            job_id="job-1",
            token="token-1",
            archive_sha256="different",
            archive_size=7,
            archive_suffix=".zip",
            archive_path=tmp_path / "other.zip",
            source_filename="other.zip",
            site="default",
        )


def test_parts_progress_independently_and_etag_changes(tmp_path: Path) -> None:
    store = _store(tmp_path)
    initial, _ = _create_job(store, tmp_path)
    populated = _populate_two_parts(store, tmp_path)
    assert populated["job"]["counts"] == {
        "total": 2,
        "queued": 2,
        "analyzing": 0,
        "ready": 0,
        "failed": 0,
        "cancelled": 0,
    }
    assert populated["etag"] != initial["etag"]

    first = store.claim_next_part("worker-1")
    assert first is not None
    after_first = store.update_part_result(
        first["id"],
        "worker-1",
        analysis={"file_id": first["file_id"], "volume_mm3": 1.0},
    )
    assert after_first["job"]["counts"]["ready"] == 1
    assert after_first["job"]["status"] == "analyzing"

    second = store.claim_next_part("worker-1")
    assert second is not None
    final = store.update_part_result(
        second["id"],
        "worker-1",
        error_code="cad_parse_failed",
        error="This CAD file could not be analyzed.",
    )
    assert final["job"]["status"] == "completed_with_errors"
    assert final["job"]["counts"]["ready"] == 1
    assert final["job"]["counts"]["failed"] == 1


def test_cancel_stops_lease_renewal_and_preserves_terminal_state(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _create_job(store, tmp_path)
    _populate_two_parts(store, tmp_path)
    running = store.claim_next_part("worker-1")
    assert running is not None

    cancelling = store.request_cancel("job-1", "token-1")
    assert cancelling["job"]["status"] == "cancelling"
    assert cancelling["job"]["counts"]["cancelled"] == 1
    assert store.renew_part_lease(running["id"], "worker-1") is False

    cancelled = store.update_part_result(
        running["id"],
        "worker-1",
        error_code="cad_cancelled",
        error="CAD analysis was cancelled.",
    )
    assert cancelled["job"]["status"] == "cancelled"
    assert cancelled["job"]["counts"]["cancelled"] == 2


def test_failed_part_can_run_only_twice(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _create_job(store, tmp_path)
    _populate_two_parts(store, tmp_path)
    first = store.claim_next_part("worker-1")
    assert first is not None
    store.update_part_result(
        first["id"],
        "worker-1",
        error_code="cad_parse_failed",
        error="Invalid CAD.",
    )
    store.retry_part("job-1", first["id"], "token-1")
    retry = store.claim_next_part("worker-1")
    assert retry is not None
    assert retry["id"] == first["id"]
    assert retry["attempt_count"] == 2
    store.update_part_result(
        retry["id"],
        "worker-1",
        error_code="cad_parse_failed",
        error="Invalid CAD.",
    )
    with pytest.raises(QuoteJobInvalidState, match="retry limit"):
        store.retry_part("job-1", first["id"], "token-1")


def test_stale_lease_is_recovered_and_worker_health_is_reported(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _create_job(store, tmp_path)
    _populate_two_parts(store, tmp_path)
    running = store.claim_next_part("worker-1", lease_seconds=0)
    assert running is not None
    assert store.recover_stale_leases() >= 1
    snapshot = store.get_snapshot("job-1", "token-1")
    assert snapshot["job"]["counts"]["queued"] == 2

    assert store.worker_health()["status"] == "unavailable"
    store.heartbeat("worker-1", active_parts=1)
    with store._connection() as connection:
        connection.execute(
            "INSERT INTO quote_worker_heartbeats(worker_id, heartbeat_at, active_parts) VALUES (?, ?, ?)",
            ("stale-worker", 1, 9),
        )
    health = store.worker_health()
    assert health["status"] == "healthy"
    assert health["active_parts"] == 1


def test_stale_part_from_cancelled_job_is_not_requeued(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _create_job(store, tmp_path)
    _populate_two_parts(store, tmp_path)
    running = store.claim_next_part("worker-1", lease_seconds=0)
    assert running is not None

    cancelling = store.request_cancel("job-1", "token-1")
    assert cancelling["job"]["status"] == "cancelling"
    assert store.recover_stale_leases() >= 1

    recovered = store.get_snapshot("job-1", "token-1")
    assert recovered["job"]["status"] == "cancelled"
    assert recovered["job"]["counts"]["queued"] == 0
    assert recovered["job"]["counts"]["cancelled"] == 2


def test_global_queue_ceiling_rejects_part_201(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.max_queued_parts = 200
    common_part = tmp_path / "part.step"
    common_part.write_bytes(b"step")

    _create_job(store, tmp_path, job_id="job-200", token="token-200")
    claimed = store.claim_extraction("worker-200")
    assert claimed is not None
    first_batch = [
        {
            "id": f"part-{index}",
            "position": index,
            "source_filename": f"folder/part-{index}.step",
            "source_format": "STEP",
            "file_id": f"file-{index}",
            "stored_path": common_part,
            "size": 4,
        }
        for index in range(200)
    ]
    first = store.populate_parts("job-200", "worker-200", first_batch)
    assert first["job"]["counts"]["queued"] == 200

    _create_job(store, tmp_path, job_id="job-201", token="token-201")
    claimed = store.claim_extraction("worker-201")
    assert claimed is not None
    overflow = store.populate_parts(
        "job-201",
        "worker-201",
        [
            {
                "id": "part-201",
                "position": 0,
                "source_filename": "overflow.step",
                "source_format": "STEP",
                "file_id": "file-201",
                "stored_path": common_part,
                "size": 4,
            }
        ],
    )
    assert overflow["job"]["status"] == "failed"
    assert overflow["job"]["error_code"] == "quote_queue_full"
    assert overflow["job"]["counts"]["total"] == 0


def test_cleanup_waits_for_active_part_then_removes_all_job_artifacts(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _create_job(store, tmp_path, job_id="cleanup-job", token="cleanup-token")
    claimed = store.claim_extraction("cleanup-worker")
    assert claimed is not None

    file_id = str(uuid.uuid4())
    part_path = tmp_path / "cleanup-job" / "parts" / f"{file_id}_part.step"
    part_path.parent.mkdir(parents=True)
    part_path.write_bytes(b"step")
    store.populate_parts(
        "cleanup-job",
        "cleanup-worker",
        [
            {
                "id": "cleanup-part",
                "position": 0,
                "source_filename": "nested/part.step",
                "source_format": "STEP",
                "file_id": file_id,
                "stored_path": part_path,
                "size": 4,
            }
        ],
    )
    running = store.claim_next_part("cleanup-worker")
    assert running is not None

    thumbnail_root = tmp_path / "thumbnails"
    stl_root = tmp_path / "stl"
    thumbnail_root.mkdir()
    stl_root.mkdir()
    thumbnail = thumbnail_root / f"{file_id}_preview.png"
    alternate_thumbnail = thumbnail_root / f"{file_id}.png"
    stl = stl_root / f"{file_id}.stl"
    unrelated = thumbnail_root / f"{uuid.uuid4()}_preview.png"
    for artifact in (thumbnail, alternate_thumbnail, stl, unrelated):
        artifact.write_bytes(b"artifact")

    with store._connection() as connection:
        connection.execute(
            "UPDATE quote_analysis_jobs SET expires_at=? WHERE id=?",
            (0, "cleanup-job"),
        )

    assert store.cleanup_expired(tmp_path, thumbnail_root, stl_root) == 0
    assert part_path.exists()
    assert thumbnail.exists()
    with store._connection() as connection:
        row = connection.execute(
            "SELECT status, cancel_requested FROM quote_analysis_jobs WHERE id=?",
            ("cleanup-job",),
        ).fetchone()
    assert dict(row) == {"status": "cancelling", "cancel_requested": 1}

    terminal = store.update_part_result(
        running["id"],
        "cleanup-worker",
        error_code="cad_cancelled",
        error="CAD analysis was cancelled.",
    )
    assert terminal["job"]["status"] == "cancelled"
    assert store.cleanup_expired(tmp_path, thumbnail_root, stl_root) == 1

    assert not (tmp_path / "cleanup-job").exists()
    assert not thumbnail.exists()
    assert not alternate_thumbnail.exists()
    assert not stl.exists()
    assert unrelated.exists()
    with store._connection() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM quote_analysis_jobs WHERE id=?",
            ("cleanup-job",),
        ).fetchone()[0] == 0


def test_cleanup_keeps_database_record_when_storage_removal_fails(
    monkeypatch,
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    _create_job(store, tmp_path, job_id="retry-cleanup", token="retry-token")
    with store._connection() as connection:
        connection.execute(
            "UPDATE quote_analysis_jobs SET status='failed', expires_at=0 WHERE id=?",
            ("retry-cleanup",),
        )

    original_rmtree = quote_jobs_module.shutil.rmtree

    def fail_removal(path):
        raise PermissionError("file is still in use")

    monkeypatch.setattr(quote_jobs_module.shutil, "rmtree", fail_removal)
    assert store.cleanup_expired(tmp_path, tmp_path / "thumbnails", tmp_path / "stl") == 0
    assert (tmp_path / "retry-cleanup" / "source.zip").exists()
    with store._connection() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM quote_analysis_jobs WHERE id=?",
            ("retry-cleanup",),
        ).fetchone()[0] == 1

    monkeypatch.setattr(quote_jobs_module.shutil, "rmtree", original_rmtree)
    assert store.cleanup_expired(tmp_path, tmp_path / "thumbnails", tmp_path / "stl") == 1
    with store._connection() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM quote_analysis_jobs WHERE id=?",
            ("retry-cleanup",),
        ).fetchone()[0] == 0


def test_cleanup_removes_only_old_strictly_named_staging_parts(
    monkeypatch,
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    staging = tmp_path / ".staging"
    staging.mkdir()
    job_id = str(uuid.uuid4())
    old_safe = staging / f"upload-{job_id}-{uuid.uuid4().hex}.part"
    recent_safe = staging / f"upload-{job_id}-{uuid.uuid4().hex}.part"
    unsafe_name = staging / "upload-not-a-job-id-deadbeef.part"
    matching_directory = staging / f"upload-{job_id}-{uuid.uuid4().hex}.part"
    old_safe.write_bytes(b"old")
    recent_safe.write_bytes(b"recent")
    unsafe_name.write_bytes(b"unsafe")
    matching_directory.mkdir()
    old_timestamp = time.time() - 7200
    os.utime(old_safe, (old_timestamp, old_timestamp))
    os.utime(unsafe_name, (old_timestamp, old_timestamp))
    os.utime(matching_directory, (old_timestamp, old_timestamp))
    monkeypatch.setenv("QUOTE_STAGING_CLEANUP_AGE_SECONDS", "3600")

    assert store.cleanup_expired(tmp_path, tmp_path / "thumbnails", tmp_path / "stl") == 0

    assert not old_safe.exists()
    assert recent_safe.exists()
    assert unsafe_name.exists()
    assert matching_directory.is_dir()
