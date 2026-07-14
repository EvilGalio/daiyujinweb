from __future__ import annotations

import io
import threading
import time
import zipfile
from pathlib import Path


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_worker_extracts_nested_archive_and_runs_two_parts_concurrently(monkeypatch, tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    monkeypatch.setenv("QUOTE_JOBS_DB_PATH", str(tmp_path / "quote_jobs.db"))
    monkeypatch.setenv("QUOTE_JOB_STORAGE_ROOT", str(tmp_path / "storage"))
    monkeypatch.setenv("QUOTE_CAD_CONCURRENCY", "2")

    import scripts.run_quote_worker as worker_module

    store = worker_module.QuoteJobStore()
    store.init()
    job_id = "worker-job"
    token = "worker-token"
    job_dir = tmp_path / "storage" / job_id
    job_dir.mkdir(parents=True)
    archive_path = job_dir / "source.zip"
    archive_path.write_bytes(
        _zip_bytes(
            {
                "folder/a.step": b"step-a",
                "folder/deeper/b.stp": b"step-b",
            }
        )
    )
    store.create_job(
        job_id=job_id,
        token=token,
        archive_sha256="sha",
        archive_size=archive_path.stat().st_size,
        archive_suffix=".zip",
        archive_path=archive_path,
        source_filename="batch.zip",
        site="default",
    )
    store.activate_job(job_id, token)

    lock = threading.Lock()
    active = 0
    maximum_active = 0

    def fake_analysis(part, cancel_event):
        nonlocal active, maximum_active
        with lock:
            active += 1
            maximum_active = max(maximum_active, active)
        time.sleep(0.08)
        with lock:
            active -= 1
        return {
            "success": True,
            "data": {
                "file_id": part["file_id"],
                "source_filename": part["source_filename"],
                "source_format": part["source_format"],
                "volume_mm3": 1.0,
            },
            "warnings": [],
            "error_code": None,
            "error": None,
        }

    monkeypatch.setattr(worker_module, "_analyze_part", fake_analysis)
    assert worker_module.run_worker(once=True) == 0

    snapshot = store.get_snapshot(job_id, token)
    assert snapshot["job"]["status"] == "completed"
    assert snapshot["job"]["counts"]["ready"] == 2
    assert [part["source_filename"] for part in snapshot["parts"]] == [
        "folder/a.step",
        "folder/deeper/b.stp",
    ]
    assert maximum_active == 2
    assert archive_path.exists() is False


def test_worker_signals_extraction_when_lease_renewal_fails(monkeypatch, tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))

    import scripts.run_quote_worker as worker_module

    extraction_stopped = threading.Event()

    class FakeStore:
        def __init__(self) -> None:
            self.claimed = False
            self.renew_calls = 0

        def init(self) -> None:
            pass

        def claim_extraction(self, worker_id, lease_seconds=30):
            if self.claimed:
                return None
            self.claimed = True
            return {"id": "lease-job"}

        def renew_extraction_lease(self, job_id, worker_id, lease_seconds=30):
            self.renew_calls += 1
            return False

        def claim_next_part(self, worker_id, lease_seconds=30):
            return None

        def heartbeat(self, worker_id, active_parts=0) -> None:
            pass

        def recover_stale_leases(self) -> int:
            return 0

        def cleanup_expired(self, storage_root, thumbnail_root, stl_root) -> int:
            return 0

        def pending_work_count(self) -> int:
            return 0

    store = FakeStore()

    def fake_extract(store_arg, worker_id, job, storage_root, cancel_event):
        if cancel_event.wait(2):
            extraction_stopped.set()

    monkeypatch.setenv("QUOTE_JOB_STORAGE_ROOT", str(tmp_path / "storage"))
    monkeypatch.setattr(worker_module, "QuoteJobStore", lambda: store)
    monkeypatch.setattr(worker_module, "_thumbnail_root", lambda: tmp_path / "thumbnails")
    monkeypatch.setattr(worker_module, "_stl_root", lambda: tmp_path / "stl")
    monkeypatch.setattr(worker_module, "_extract_job", fake_extract)
    monkeypatch.setattr(worker_module, "HEARTBEAT_SECONDS", 0)

    assert worker_module.run_worker(once=True) == 0
    assert extraction_stopped.is_set()
    assert store.renew_calls == 1


def test_extract_job_stops_after_lease_loss_and_keeps_archive(monkeypatch, tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))

    import scripts.run_quote_worker as worker_module
    from services.archive_reader import ArchiveMember, ExtractedArchiveMember

    archive_path = tmp_path / "storage" / "cancelled-job" / "source.zip"
    archive_path.parent.mkdir(parents=True)
    archive_path.write_bytes(b"archive")
    extracted_path = archive_path.parent / "parts" / "part.step"
    cancel_event = threading.Event()

    class FakeStore:
        def populate_parts(self, job_id, worker_id, parts, warnings):
            raise AssertionError("A stale extraction must not publish parts.")

    def fake_list(*args, **kwargs):
        return [ArchiveMember(name="nested/part.step", size=4)], []

    def fake_extract(*args, **kwargs):
        extracted_path.parent.mkdir(parents=True)
        extracted_path.write_bytes(b"step")
        cancel_event.set()
        return [
            ExtractedArchiveMember(
                member=ArchiveMember(name="nested/part.step", size=4),
                file_id="part-id",
                path=extracted_path,
            )
        ]

    monkeypatch.setattr(worker_module, "list_cad_members", fake_list)
    monkeypatch.setattr(worker_module, "extract_cad_members", fake_extract)

    worker_module._extract_job(
        FakeStore(),
        "old-owner",
        {
            "id": "cancelled-job",
            "archive_path": str(archive_path),
            "archive_suffix": ".zip",
        },
        tmp_path / "storage",
        cancel_event,
    )

    assert archive_path.exists()
    assert extracted_path.exists() is False


def test_stale_extractor_does_not_delete_archive_needed_by_new_owner(monkeypatch, tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))

    import scripts.run_quote_worker as worker_module
    from services.archive_reader import ArchiveMember, ExtractedArchiveMember

    archive_path = tmp_path / "storage" / "reclaimed-job" / "source.zip"
    archive_path.parent.mkdir(parents=True)
    archive_path.write_bytes(b"archive")
    extracted_path = archive_path.parent / "parts" / "old-owner.step"

    class FakeStore:
        def populate_parts(self, job_id, worker_id, parts, warnings):
            raise worker_module.QuoteJobInvalidState("Lease belongs to a new owner.")

    def fake_list(*args, **kwargs):
        return [ArchiveMember(name="part.step", size=4)], []

    def fake_extract(*args, **kwargs):
        extracted_path.parent.mkdir(parents=True)
        extracted_path.write_bytes(b"step")
        return [
            ExtractedArchiveMember(
                member=ArchiveMember(name="part.step", size=4),
                file_id="old-part-id",
                path=extracted_path,
            )
        ]

    monkeypatch.setattr(worker_module, "list_cad_members", fake_list)
    monkeypatch.setattr(worker_module, "extract_cad_members", fake_extract)

    worker_module._extract_job(
        FakeStore(),
        "old-owner",
        {
            "id": "reclaimed-job",
            "archive_path": str(archive_path),
            "archive_suffix": ".zip",
        },
        tmp_path / "storage",
        threading.Event(),
    )

    assert archive_path.exists()
    assert extracted_path.exists() is False
