from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.archive_reader import (
    ArchiveDependencyError,
    ArchiveReadError,
    extract_cad_members,
    list_cad_members,
)
from services.cad_analyzer import SUPPORTED_CAD_EXTENSIONS, cad_format_for_path
from services.quote_cad_runner import run_cad_analysis
from services.quote_jobs import QuoteJobInvalidState, QuoteJobNotFound, QuoteJobStore


MAX_CAD_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_CAD_BYTES = 150 * 1024 * 1024
MAX_ARCHIVE_PARTS = 50
LEASE_SECONDS = 30
HEARTBEAT_SECONDS = 5
RECOVERY_SECONDS = 10
CLEANUP_SECONDS = 60


@dataclass
class RunningPart:
    part: dict[str, Any]
    future: Future
    cancel_event: threading.Event
    last_lease_at: float


def _storage_root() -> Path:
    configured = os.environ.get("QUOTE_JOB_STORAGE_ROOT")
    return Path(configured).resolve() if configured else (BACKEND_ROOT / "uploads" / "quote-jobs").resolve()


def _thumbnail_root() -> Path:
    return (BACKEND_ROOT / "static" / "thumbnails").resolve()


def _stl_root() -> Path:
    return (BACKEND_ROOT / "static" / "stl").resolve()


def _remove_extracted_files(extracted: list[Any]) -> None:
    for item in extracted:
        item.path.unlink(missing_ok=True)


def _extract_job(
    store: QuoteJobStore,
    worker_id: str,
    job: dict[str, Any],
    storage_root: Path,
    cancel_event: threading.Event,
) -> None:
    archive_path = Path(job["archive_path"])
    destination = storage_root / job["id"] / "parts"
    extracted: list[Any] = []
    transition_committed = False
    parts_published = False
    try:
        if cancel_event.is_set():
            return
        members, warnings = list_cad_members(
            archive_path,
            job["archive_suffix"],
            cad_extensions=SUPPORTED_CAD_EXTENSIONS,
            max_file_size=MAX_CAD_BYTES,
            max_total_size=MAX_ARCHIVE_CAD_BYTES,
            max_files=MAX_ARCHIVE_PARTS,
        )
        if cancel_event.is_set():
            return
        extracted = extract_cad_members(
            archive_path,
            job["archive_suffix"],
            members,
            destination,
        )
        if cancel_event.is_set():
            return
        parts = [
            {
                "id": str(uuid.uuid4()),
                "position": position,
                "source_filename": item.member.name,
                "source_format": cad_format_for_path(item.path),
                "file_id": item.file_id,
                "stored_path": str(item.path),
                "size": item.member.size,
            }
            for position, item in enumerate(extracted)
        ]
        snapshot = store.populate_parts(job["id"], worker_id, parts, warnings)
        transition_committed = True
        parts_published = bool(snapshot.get("parts"))
    except ArchiveDependencyError as exc:
        if not cancel_event.is_set():
            try:
                store.fail_extraction(
                    job["id"],
                    worker_id,
                    "archive_support_unavailable",
                    str(exc),
                )
                transition_committed = True
            except (QuoteJobInvalidState, QuoteJobNotFound):
                pass
    except ArchiveReadError as exc:
        if not cancel_event.is_set():
            try:
                store.fail_extraction(job["id"], worker_id, "invalid_archive", str(exc))
                transition_committed = True
            except (QuoteJobInvalidState, QuoteJobNotFound):
                pass
    except (QuoteJobInvalidState, QuoteJobNotFound):
        pass
    except Exception:
        if not cancel_event.is_set():
            try:
                store.fail_extraction(
                    job["id"],
                    worker_id,
                    "archive_processing_failed",
                    "The archive could not be processed.",
                )
                transition_committed = True
            except (QuoteJobInvalidState, QuoteJobNotFound):
                pass
    finally:
        if not parts_published:
            _remove_extracted_files(extracted)
        if transition_committed:
            archive_path.unlink(missing_ok=True)


def _analyze_part(part: dict[str, Any], cancel_event: threading.Event) -> dict[str, Any]:
    result = run_cad_analysis(
        backend_root=BACKEND_ROOT,
        occ_python=os.environ.get("OCC_PYTHON", r"D:\anaconda\envs\occ\python.exe"),
        saved_path=part["stored_path"],
        display_name=Path(part["source_filename"]).name,
        source_filename=part["source_filename"],
        file_id=part["file_id"],
        thumbnail_dir=_thumbnail_root(),
        site=part.get("site") or "default",
        timeout_seconds=max(1, int(os.environ.get("QUOTE_CAD_TIMEOUT_SECONDS", "90"))),
        preview_width=max(800, int(os.environ.get("QUOTE_PREVIEW_WIDTH", "1280"))),
        preview_height=max(450, int(os.environ.get("QUOTE_PREVIEW_HEIGHT", "720"))),
        cancel_event=cancel_event,
    )
    if result.get("success") and isinstance(result.get("data"), dict):
        result["data"]["file_id"] = part["file_id"]
    return result


def _finish_part(store: QuoteJobStore, worker_id: str, running: RunningPart) -> None:
    try:
        result = running.future.result()
    except Exception:
        result = {
            "success": False,
            "error_code": "cad_worker_error",
            "error": "CAD analysis stopped unexpectedly.",
            "warnings": [],
        }
    code = result.get("error_code")
    retryable = code in {"cad_timeout", "cad_process_failed", "cad_worker_error"}
    try:
        store.update_part_result(
            running.part["id"],
            worker_id,
            analysis=result.get("data") if result.get("success") else None,
            warnings=result.get("warnings") or (),
            error_code=code,
            error=result.get("error"),
            retryable=retryable,
        )
    except (QuoteJobInvalidState, QuoteJobNotFound):
        pass


def run_worker(*, once: bool = False) -> int:
    store = QuoteJobStore()
    store.init()
    storage_root = _storage_root()
    storage_root.mkdir(parents=True, exist_ok=True)
    _thumbnail_root().mkdir(parents=True, exist_ok=True)
    _stl_root().mkdir(parents=True, exist_ok=True)

    concurrency = min(4, max(1, int(os.environ.get("QUOTE_CAD_CONCURRENCY", "2"))))
    worker_id = f"quote-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    stop_event = threading.Event()

    def request_stop(signum, frame) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)

    logging.info("Quote worker started worker_id=%s concurrency=%s", worker_id, concurrency)
    running_parts: dict[str, RunningPart] = {}
    extraction_future: Future | None = None
    extraction_job_id: str | None = None
    extraction_cancel_event: threading.Event | None = None
    extraction_last_lease_at = 0.0
    part_pool = ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="quote-occ")
    extraction_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="quote-extract")
    last_heartbeat = 0.0
    last_recovery = 0.0
    last_cleanup = 0.0
    idle_rounds = 0

    try:
        while not stop_event.is_set():
            now = time.monotonic()
            if extraction_future is not None and extraction_future.done():
                try:
                    extraction_future.result()
                except Exception:
                    logging.exception("Archive extraction task failed")
                extraction_future = None
                extraction_job_id = None
                extraction_cancel_event = None

            completed_ids = [part_id for part_id, running in running_parts.items() if running.future.done()]
            for part_id in completed_ids:
                running = running_parts.pop(part_id)
                _finish_part(store, worker_id, running)

            for running in running_parts.values():
                if now - running.last_lease_at >= HEARTBEAT_SECONDS:
                    if not store.renew_part_lease(running.part["id"], worker_id, LEASE_SECONDS):
                        running.cancel_event.set()
                    running.last_lease_at = now

            if extraction_future is not None and extraction_job_id is not None:
                if (
                    extraction_cancel_event is not None
                    and not extraction_cancel_event.is_set()
                    and now - extraction_last_lease_at >= HEARTBEAT_SECONDS
                ):
                    try:
                        renewed = store.renew_extraction_lease(
                            extraction_job_id,
                            worker_id,
                            lease_seconds=300,
                        )
                    except Exception:
                        logging.exception("Archive extraction lease renewal failed")
                        renewed = False
                    if not renewed:
                        logging.warning(
                            "Archive extraction lease lost job_id=%s worker_id=%s",
                            extraction_job_id,
                            worker_id,
                        )
                        extraction_cancel_event.set()
                    extraction_last_lease_at = now

            if now - last_heartbeat >= HEARTBEAT_SECONDS:
                store.heartbeat(worker_id, active_parts=len(running_parts))
                last_heartbeat = now
            if now - last_recovery >= RECOVERY_SECONDS:
                store.recover_stale_leases()
                last_recovery = now
            if now - last_cleanup >= CLEANUP_SECONDS:
                store.cleanup_expired(storage_root, _thumbnail_root(), _stl_root())
                last_cleanup = now

            claimed_work = False
            if extraction_future is None:
                job = store.claim_extraction(worker_id, lease_seconds=300)
                if job is not None:
                    extraction_cancel_event = threading.Event()
                    extraction_future = extraction_pool.submit(
                        _extract_job,
                        store,
                        worker_id,
                        job,
                        storage_root,
                        extraction_cancel_event,
                    )
                    extraction_job_id = job["id"]
                    extraction_last_lease_at = now
                    claimed_work = True

            while len(running_parts) < concurrency:
                part = store.claim_next_part(worker_id, lease_seconds=LEASE_SECONDS)
                if part is None:
                    break
                cancel_event = threading.Event()
                future = part_pool.submit(_analyze_part, part, cancel_event)
                running_parts[part["id"]] = RunningPart(part, future, cancel_event, now)
                claimed_work = True

            if claimed_work or running_parts or extraction_future is not None:
                idle_rounds = 0
            else:
                if once and store.pending_work_count() > 0:
                    idle_rounds = 0
                else:
                    idle_rounds += 1
                    if once and idle_rounds >= 2:
                        break
            time.sleep(0.25)
    finally:
        for running in running_parts.values():
            running.cancel_event.set()
        if extraction_cancel_event is not None:
            extraction_cancel_event.set()
        part_pool.shutdown(wait=True, cancel_futures=True)
        extraction_pool.shutdown(wait=True, cancel_futures=True)
        store.heartbeat(worker_id, active_parts=0)
        logging.info("Quote worker stopped worker_id=%s", worker_id)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the durable Online Quote archive worker.")
    parser.add_argument("--init-db", action="store_true", help="Initialize quote_jobs.db and exit.")
    parser.add_argument("--once", action="store_true", help="Drain currently available work and exit.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.init_db:
        store = QuoteJobStore()
        store.init()
        print(f"Quote job database ready: {store.path}")
        return 0
    return run_worker(once=args.once)


if __name__ == "__main__":
    raise SystemExit(main())
