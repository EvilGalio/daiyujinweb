from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shutil
import sqlite3
import stat
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "quote_jobs.db"
TERMINAL_JOB_STATES = {"completed", "completed_with_errors", "failed", "cancelled", "expired"}
TERMINAL_PART_STATES = {"ready", "failed", "cancelled"}
STAGING_UPLOAD_PATTERN = re.compile(
    r"^upload-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{32}\.part$"
)
DEFAULT_STAGING_CLEANUP_AGE_SECONDS = 6 * 3600
MIN_STAGING_CLEANUP_AGE_SECONDS = 3600


class QuoteJobError(RuntimeError):
    pass


class QuoteJobNotFound(QuoteJobError):
    pass


class QuoteJobUnauthorized(QuoteJobError):
    pass


class QuoteJobConflict(QuoteJobError):
    pass


class QuoteJobInvalidState(QuoteJobError):
    pass


class QuoteJobExpired(QuoteJobError):
    pass


class QuoteJobCapacityError(QuoteJobError):
    pass


def _now() -> float:
    return time.time()


def _iso(value: float | int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_load(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _exists_or_symlink(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _remove_file_and_verify(path: Path) -> bool:
    if not _exists_or_symlink(path):
        return True
    try:
        path.unlink()
    except OSError:
        return False
    return not _exists_or_symlink(path)


class QuoteJobStore:
    def __init__(self, path: str | Path | None = None) -> None:
        configured = path or os.environ.get("QUOTE_JOBS_DB_PATH") or DEFAULT_DB_PATH
        self.path = Path(configured).expanduser().resolve()
        self.ttl_hours = max(1, int(os.environ.get("QUOTE_JOB_TTL_HOURS", "24")))
        self.max_active_jobs = max(1, int(os.environ.get("QUOTE_MAX_ACTIVE_JOBS", "20")))
        self.max_client_jobs = max(1, int(os.environ.get("QUOTE_MAX_CLIENT_JOBS", "2")))
        self.max_queued_parts = max(1, int(os.environ.get("QUOTE_MAX_QUEUED_PARTS", "200")))

    @contextmanager
    def _connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA synchronous=NORMAL")
        try:
            yield connection
        finally:
            connection.close()

    def init(self) -> None:
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS quote_analysis_jobs (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL,
                    archive_sha256 TEXT NOT NULL,
                    archive_size INTEGER NOT NULL,
                    archive_suffix TEXT NOT NULL,
                    archive_path TEXT NOT NULL,
                    source_filename TEXT NOT NULL,
                    site TEXT NOT NULL,
                    client_ip_hash TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    warnings_json TEXT NOT NULL DEFAULT '[]',
                    error_code TEXT,
                    error TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    lease_owner TEXT,
                    lease_expires_at REAL,
                    last_dispatched_at REAL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS quote_analysis_parts (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES quote_analysis_jobs(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    source_filename TEXT NOT NULL,
                    source_format TEXT NOT NULL,
                    file_id TEXT NOT NULL,
                    stored_path TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 2,
                    analysis_json TEXT,
                    warnings_json TEXT NOT NULL DEFAULT '[]',
                    error_code TEXT,
                    error TEXT,
                    available_at REAL NOT NULL,
                    lease_owner TEXT,
                    lease_expires_at REAL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    UNIQUE(job_id, position)
                );

                CREATE TABLE IF NOT EXISTS quote_worker_heartbeats (
                    worker_id TEXT PRIMARY KEY,
                    heartbeat_at REAL NOT NULL,
                    active_parts INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_quote_jobs_claim
                    ON quote_analysis_jobs(status, lease_expires_at, created_at);
                CREATE INDEX IF NOT EXISTS idx_quote_jobs_expiry
                    ON quote_analysis_jobs(expires_at);
                CREATE INDEX IF NOT EXISTS idx_quote_jobs_client
                    ON quote_analysis_jobs(client_ip_hash, status);
                CREATE INDEX IF NOT EXISTS idx_quote_parts_claim
                    ON quote_analysis_parts(status, available_at, lease_expires_at, position);
                CREATE INDEX IF NOT EXISTS idx_quote_parts_job
                    ON quote_analysis_parts(job_id, position);
                """
            )

    def create_job(
        self,
        *,
        job_id: str,
        token: str,
        archive_sha256: str,
        archive_size: int,
        archive_suffix: str,
        archive_path: str | Path,
        source_filename: str,
        site: str,
        client_ip_hash: str = "",
        ttl_hours: int | None = None,
    ) -> tuple[dict[str, Any], bool]:
        now = _now()
        expires_at = now + max(1, ttl_hours or self.ttl_hours) * 3600
        token_digest = _token_hash(token)
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM quote_analysis_jobs WHERE id=?",
                    (job_id,),
                ).fetchone()
                if existing is not None:
                    if not hmac.compare_digest(existing["token_hash"], token_digest):
                        raise QuoteJobUnauthorized("Invalid analysis job token.")
                    expected = (
                        existing["archive_sha256"],
                        int(existing["archive_size"]),
                        existing["archive_suffix"],
                        existing["site"],
                    )
                    supplied = (archive_sha256, int(archive_size), archive_suffix, site)
                    if expected != supplied:
                        raise QuoteJobConflict("The idempotency key was already used for another upload.")
                    connection.commit()
                    return self._snapshot_with_connection(connection, job_id), False

                active_count = connection.execute(
                    "SELECT COUNT(*) FROM quote_analysis_jobs WHERE status NOT IN ('completed','completed_with_errors','failed','cancelled','expired') AND expires_at>?",
                    (now,),
                ).fetchone()[0]
                if int(active_count) >= self.max_active_jobs:
                    raise QuoteJobCapacityError("The analysis queue is full. Please retry shortly.")
                if client_ip_hash:
                    client_count = connection.execute(
                        "SELECT COUNT(*) FROM quote_analysis_jobs WHERE client_ip_hash=? AND status NOT IN ('completed','completed_with_errors','failed','cancelled','expired') AND expires_at>?",
                        (client_ip_hash, now),
                    ).fetchone()[0]
                    if int(client_count) >= self.max_client_jobs:
                        raise QuoteJobCapacityError("This client already has active analysis jobs.")

                connection.execute(
                    """
                    INSERT INTO quote_analysis_jobs (
                        id, token_hash, archive_sha256, archive_size, archive_suffix,
                        archive_path, source_filename, site, client_ip_hash, status,
                        version, created_at, updated_at, expires_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 1, ?, ?, ?)
                    """,
                    (
                        job_id,
                        token_digest,
                        archive_sha256,
                        int(archive_size),
                        archive_suffix,
                        str(Path(archive_path).resolve()),
                        source_filename,
                        site,
                        client_ip_hash,
                        now,
                        now,
                        expires_at,
                    ),
                )
                connection.commit()
                return self._snapshot_with_connection(connection, job_id), True
            except Exception:
                connection.rollback()
                raise

    def activate_job(self, job_id: str, token: str) -> dict[str, Any]:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = self._authenticated_row(connection, job_id, token)
                if row["status"] == "uploading":
                    if not Path(row["archive_path"]).is_file():
                        raise QuoteJobInvalidState("The uploaded archive is not available.")
                    connection.execute(
                        "UPDATE quote_analysis_jobs SET status='queued', updated_at=?, version=version+1 WHERE id=?",
                        (now, job_id),
                    )
                elif row["status"] not in TERMINAL_JOB_STATES and row["status"] != "queued":
                    raise QuoteJobInvalidState("The analysis job cannot be activated from its current state.")
                connection.commit()
                return self._snapshot_with_connection(connection, job_id)
            except Exception:
                connection.rollback()
                raise

    def abort_upload(self, job_id: str, token: str) -> bool:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = self._authenticated_row(connection, job_id, token)
                if row["status"] != "uploading":
                    connection.commit()
                    return False
                deleted = connection.execute(
                    "DELETE FROM quote_analysis_jobs WHERE id=? AND status='uploading'",
                    (job_id,),
                ).rowcount
                connection.commit()
                return bool(deleted)
            except Exception:
                connection.rollback()
                raise

    def authenticate(self, job_id: str, token: str) -> dict[str, Any]:
        with self._connection() as connection:
            row = self._authenticated_row(connection, job_id, token)
            return dict(row)

    def get_snapshot(self, job_id: str, token: str) -> dict[str, Any]:
        with self._connection() as connection:
            self._authenticated_row(connection, job_id, token)
            return self._snapshot_with_connection(connection, job_id)

    def claim_extraction(self, worker_id: str, lease_seconds: int = 30) -> dict[str, Any] | None:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute(
                    """
                    SELECT * FROM quote_analysis_jobs
                    WHERE status='queued' AND cancel_requested=0 AND expires_at>?
                      AND (lease_expires_at IS NULL OR lease_expires_at<?)
                    ORDER BY created_at, id LIMIT 1
                    """,
                    (now, now),
                ).fetchone()
                if row is None:
                    connection.commit()
                    return None
                updated = connection.execute(
                    """
                    UPDATE quote_analysis_jobs
                    SET status='extracting', lease_owner=?, lease_expires_at=?,
                        updated_at=?, version=version+1
                    WHERE id=? AND status='queued' AND cancel_requested=0
                    """,
                    (worker_id, now + lease_seconds, now, row["id"]),
                ).rowcount
                connection.commit()
                if not updated:
                    return None
                return self._job_internal(row["id"])
            except Exception:
                connection.rollback()
                raise

    def populate_parts(
        self,
        job_id: str,
        worker_id: str,
        parts: Iterable[dict[str, Any]],
        warnings: Iterable[str] = (),
    ) -> dict[str, Any]:
        part_list = list(parts)
        if not part_list:
            return self.fail_extraction(
                job_id,
                worker_id,
                "invalid_archive",
                "Archive does not contain supported CAD files.",
            )
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                job = connection.execute(
                    "SELECT * FROM quote_analysis_jobs WHERE id=?",
                    (job_id,),
                ).fetchone()
                if job is None:
                    raise QuoteJobNotFound("Analysis job was not found.")
                if job["status"] != "extracting" or job["lease_owner"] != worker_id:
                    raise QuoteJobInvalidState("Extraction lease is no longer active.")
                if job["cancel_requested"]:
                    connection.execute(
                        "UPDATE quote_analysis_jobs SET status='cancelled', lease_owner=NULL, lease_expires_at=NULL, updated_at=?, version=version+1 WHERE id=?",
                        (now, job_id),
                    )
                    connection.commit()
                    return self._snapshot_with_connection(connection, job_id)

                queued_parts = connection.execute(
                    "SELECT COUNT(*) FROM quote_analysis_parts WHERE status IN ('queued','analyzing')",
                ).fetchone()[0]
                if int(queued_parts) + len(part_list) > self.max_queued_parts:
                    connection.execute(
                        """
                        UPDATE quote_analysis_jobs
                        SET status='failed', error_code='quote_queue_full',
                            error='The CAD analysis queue is full. Please retry later.',
                            lease_owner=NULL, lease_expires_at=NULL,
                            updated_at=?, version=version+1
                        WHERE id=?
                        """,
                        (now, job_id),
                    )
                    connection.commit()
                    return self._snapshot_with_connection(connection, job_id)

                for index, item in enumerate(part_list):
                    part_id = str(item.get("id") or uuid.uuid4())
                    connection.execute(
                        """
                        INSERT INTO quote_analysis_parts (
                            id, job_id, position, source_filename, source_format,
                            file_id, stored_path, size, status, phase,
                            available_at, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'Queued for CAD analysis', ?, ?, ?)
                        """,
                        (
                            part_id,
                            job_id,
                            int(item.get("position", index)),
                            str(item.get("source_filename") or "CAD part"),
                            str(item.get("source_format") or ""),
                            str(item.get("file_id") or part_id),
                            str(Path(item["stored_path"]).resolve()),
                            int(item.get("size") or 0),
                            now,
                            now,
                            now,
                        ),
                    )
                connection.execute(
                    """
                    UPDATE quote_analysis_jobs
                    SET status='analyzing', warnings_json=?, lease_owner=NULL,
                        lease_expires_at=NULL, updated_at=?, version=version+1
                    WHERE id=?
                    """,
                    (_json_dump(list(warnings)), now, job_id),
                )
                connection.commit()
                return self._snapshot_with_connection(connection, job_id)
            except Exception:
                connection.rollback()
                raise

    def fail_extraction(
        self,
        job_id: str,
        worker_id: str,
        error_code: str,
        error: str,
    ) -> dict[str, Any]:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute(
                    "SELECT status, lease_owner FROM quote_analysis_jobs WHERE id=?",
                    (job_id,),
                ).fetchone()
                if row is None:
                    raise QuoteJobNotFound("Analysis job was not found.")
                if row["status"] != "extracting" or row["lease_owner"] != worker_id:
                    raise QuoteJobInvalidState("Extraction lease is no longer active.")
                connection.execute(
                    """
                    UPDATE quote_analysis_jobs
                    SET status='failed', error_code=?, error=?, lease_owner=NULL,
                        lease_expires_at=NULL, updated_at=?, version=version+1
                    WHERE id=?
                    """,
                    (error_code, error, now, job_id),
                )
                connection.commit()
                return self._snapshot_with_connection(connection, job_id)
            except Exception:
                connection.rollback()
                raise

    def claim_next_part(self, worker_id: str, lease_seconds: int = 30) -> dict[str, Any] | None:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute(
                    """
                    SELECT p.id
                    FROM quote_analysis_parts p
                    JOIN quote_analysis_jobs j ON j.id=p.job_id
                    WHERE p.status='queued' AND p.available_at<=?
                      AND (p.lease_expires_at IS NULL OR p.lease_expires_at<?)
                      AND j.status='analyzing' AND j.cancel_requested=0 AND j.expires_at>?
                    ORDER BY COALESCE(j.last_dispatched_at, 0), j.created_at, p.position
                    LIMIT 1
                    """,
                    (now, now, now),
                ).fetchone()
                if row is None:
                    connection.commit()
                    return None
                part = connection.execute(
                    "SELECT * FROM quote_analysis_parts WHERE id=?",
                    (row["id"],),
                ).fetchone()
                if part is None:
                    connection.commit()
                    return None
                updated = connection.execute(
                    """
                    UPDATE quote_analysis_parts
                    SET status='analyzing', phase='Analyzing CAD geometry',
                        attempt_count=attempt_count+1, lease_owner=?, lease_expires_at=?, updated_at=?
                    WHERE id=? AND status='queued'
                    """,
                    (worker_id, now + lease_seconds, now, part["id"]),
                ).rowcount
                if not updated:
                    connection.commit()
                    return None
                connection.execute(
                    "UPDATE quote_analysis_jobs SET last_dispatched_at=?, updated_at=?, version=version+1 WHERE id=?",
                    (now, now, part["job_id"]),
                )
                connection.commit()
                return self._part_internal(part["id"])
            except Exception:
                connection.rollback()
                raise

    def renew_part_lease(self, part_id: str, worker_id: str, lease_seconds: int = 30) -> bool:
        now = _now()
        with self._connection() as connection:
            updated = connection.execute(
                """
                UPDATE quote_analysis_parts
                SET lease_expires_at=?, updated_at=?
                WHERE id=? AND lease_owner=? AND status='analyzing'
                  AND EXISTS (
                      SELECT 1 FROM quote_analysis_jobs j
                      WHERE j.id=quote_analysis_parts.job_id AND j.cancel_requested=0
                  )
                """,
                (now + lease_seconds, now, part_id, worker_id),
            ).rowcount
            return bool(updated)

    def renew_extraction_lease(self, job_id: str, worker_id: str, lease_seconds: int = 30) -> bool:
        now = _now()
        with self._connection() as connection:
            updated = connection.execute(
                """
                UPDATE quote_analysis_jobs
                SET lease_expires_at=?, updated_at=?, version=version+1
                WHERE id=? AND lease_owner=? AND status='extracting'
                  AND cancel_requested=0 AND expires_at>?
                """,
                (now + lease_seconds, now, job_id, worker_id, now),
            ).rowcount
            return bool(updated)

    def update_part_result(
        self,
        part_id: str,
        worker_id: str,
        analysis: dict[str, Any] | None = None,
        warnings: Iterable[str] = (),
        error_code: str | None = None,
        error: str | None = None,
        retryable: bool = False,
    ) -> dict[str, Any]:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                part = connection.execute(
                    "SELECT * FROM quote_analysis_parts WHERE id=?",
                    (part_id,),
                ).fetchone()
                if part is None:
                    raise QuoteJobNotFound("Analysis part was not found.")
                if part["status"] != "analyzing" or part["lease_owner"] != worker_id:
                    raise QuoteJobInvalidState("Part lease is no longer active.")
                job = connection.execute(
                    "SELECT cancel_requested FROM quote_analysis_jobs WHERE id=?",
                    (part["job_id"],),
                ).fetchone()
                cancelled = bool(job and job["cancel_requested"]) or error_code == "cad_cancelled"

                if analysis is not None and not error_code and not cancelled:
                    status = "ready"
                    phase = "Preview ready"
                    analysis_json = _json_dump(analysis)
                    next_error_code = None
                    next_error = None
                    available_at = now
                elif cancelled:
                    status = "cancelled"
                    phase = "Analysis cancelled"
                    analysis_json = None
                    next_error_code = "cad_cancelled"
                    next_error = "CAD analysis was cancelled."
                    available_at = now
                elif retryable and int(part["attempt_count"]) < int(part["max_attempts"]):
                    status = "queued"
                    phase = "Retry queued"
                    analysis_json = None
                    next_error_code = error_code
                    next_error = error
                    available_at = now + 2
                else:
                    status = "failed"
                    phase = "CAD analysis failed"
                    analysis_json = None
                    next_error_code = error_code or "cad_analysis_failed"
                    next_error = error or "This CAD file could not be analyzed."
                    available_at = now

                connection.execute(
                    """
                    UPDATE quote_analysis_parts
                    SET status=?, phase=?, analysis_json=?, warnings_json=?,
                        error_code=?, error=?, available_at=?, lease_owner=NULL,
                        lease_expires_at=NULL, updated_at=?
                    WHERE id=?
                    """,
                    (
                        status,
                        phase,
                        analysis_json,
                        _json_dump(list(warnings)),
                        next_error_code,
                        next_error,
                        available_at,
                        now,
                        part_id,
                    ),
                )
                self._refresh_job_state(connection, part["job_id"], now)
                connection.commit()
                return self._snapshot_with_connection(connection, part["job_id"])
            except Exception:
                connection.rollback()
                raise

    def request_cancel(self, job_id: str, token: str) -> dict[str, Any]:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                job = self._authenticated_row(connection, job_id, token)
                if job["status"] in TERMINAL_JOB_STATES:
                    connection.commit()
                    return self._snapshot_with_connection(connection, job_id)
                connection.execute(
                    "UPDATE quote_analysis_parts SET status='cancelled', phase='Analysis cancelled', lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE job_id=? AND status='queued'",
                    (now, job_id),
                )
                active = connection.execute(
                    "SELECT COUNT(*) FROM quote_analysis_parts WHERE job_id=? AND status='analyzing'",
                    (job_id,),
                ).fetchone()[0]
                status = "cancelling" if int(active) else "cancelled"
                connection.execute(
                    "UPDATE quote_analysis_jobs SET cancel_requested=1, status=?, updated_at=?, version=version+1 WHERE id=?",
                    (status, now, job_id),
                )
                connection.commit()
                return self._snapshot_with_connection(connection, job_id)
            except Exception:
                connection.rollback()
                raise

    def retry_part(self, job_id: str, part_id: str, token: str) -> dict[str, Any]:
        now = _now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                job = self._authenticated_row(connection, job_id, token)
                if job["status"] in {"cancelled", "expired"} or job["cancel_requested"]:
                    raise QuoteJobInvalidState("Cancelled or expired jobs cannot be retried.")
                part = connection.execute(
                    "SELECT * FROM quote_analysis_parts WHERE id=? AND job_id=?",
                    (part_id, job_id),
                ).fetchone()
                if part is None:
                    raise QuoteJobNotFound("Analysis part was not found.")
                if part["status"] != "failed":
                    raise QuoteJobInvalidState("Only failed parts can be retried.")
                if int(part["attempt_count"]) >= int(part["max_attempts"]):
                    raise QuoteJobInvalidState("This part has reached its retry limit.")
                connection.execute(
                    """
                    UPDATE quote_analysis_parts
                    SET status='queued', phase='Retry queued', analysis_json=NULL,
                        warnings_json='[]', error_code=NULL, error=NULL,
                        available_at=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=?
                    WHERE id=?
                    """,
                    (now, now, part_id),
                )
                connection.execute(
                    "UPDATE quote_analysis_jobs SET status='analyzing', error_code=NULL, error=NULL, updated_at=?, version=version+1 WHERE id=?",
                    (now, job_id),
                )
                connection.commit()
                return self._snapshot_with_connection(connection, job_id)
            except Exception:
                connection.rollback()
                raise

    def heartbeat(self, worker_id: str, active_parts: int = 0) -> None:
        now = _now()
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO quote_worker_heartbeats(worker_id, heartbeat_at, active_parts)
                VALUES (?, ?, ?)
                ON CONFLICT(worker_id) DO UPDATE SET
                    heartbeat_at=excluded.heartbeat_at,
                    active_parts=excluded.active_parts
                """,
                (worker_id, now, max(0, int(active_parts))),
            )

    def worker_health(self, stale_after_seconds: int = 15) -> dict[str, Any]:
        cutoff = _now() - max(1, stale_after_seconds)
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT MAX(heartbeat_at) AS heartbeat_at,
                       SUM(CASE WHEN heartbeat_at>=? THEN active_parts ELSE 0 END) AS active_parts
                FROM quote_worker_heartbeats
                """,
                (cutoff,),
            ).fetchone()
            queued_parts = connection.execute(
                "SELECT COUNT(*) FROM quote_analysis_parts WHERE status='queued'"
            ).fetchone()[0]
        heartbeat_at = row["heartbeat_at"] if row else None
        if heartbeat_at is None:
            status = "unavailable"
        elif _now() - float(heartbeat_at) > stale_after_seconds:
            status = "stale"
        else:
            status = "healthy"
        return {
            "status": status,
            "last_heartbeat_at": _iso(heartbeat_at),
            "active_parts": int((row["active_parts"] if row else 0) or 0),
            "queued_parts": int(queued_parts or 0),
        }

    def pending_work_count(self) -> int:
        now = _now()
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*)
                FROM quote_analysis_jobs j
                WHERE j.expires_at>?
                  AND (
                      j.status IN ('queued','extracting','analyzing')
                      OR (
                          j.status='cancelling'
                          AND (
                              j.lease_expires_at>?
                              OR EXISTS (
                                  SELECT 1 FROM quote_analysis_parts p
                                  WHERE p.job_id=j.id AND p.status='analyzing'
                              )
                          )
                      )
                  )
                """,
                (now, now),
            ).fetchone()
        return int(row[0] if row else 0)

    def recover_stale_leases(self) -> int:
        now = _now()
        affected_jobs: set[str] = set()
        recovered = 0
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                extraction_jobs = connection.execute(
                    "SELECT id, cancel_requested FROM quote_analysis_jobs WHERE status='extracting' AND lease_expires_at<?",
                    (now,),
                ).fetchall()
                for row in extraction_jobs:
                    next_status = "cancelled" if row["cancel_requested"] else "queued"
                    connection.execute(
                        "UPDATE quote_analysis_jobs SET status=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=?, version=version+1 WHERE id=?",
                        (next_status, now, row["id"]),
                    )
                    recovered += 1

                stale_parts = connection.execute(
                    """
                    SELECT p.*, j.cancel_requested
                    FROM quote_analysis_parts p
                    JOIN quote_analysis_jobs j ON j.id=p.job_id
                    WHERE p.status='analyzing' AND p.lease_expires_at<?
                    """,
                    (now,),
                ).fetchall()
                for part in stale_parts:
                    affected_jobs.add(part["job_id"])
                    if part["cancel_requested"]:
                        status = "cancelled"
                        phase = "Analysis cancelled"
                        error_code = "cad_cancelled"
                        error = "CAD analysis was cancelled."
                        available_at = now
                    elif int(part["attempt_count"]) < int(part["max_attempts"]):
                        status = "queued"
                        phase = "Recovered after worker restart"
                        error_code = "worker_lost"
                        error = "Analysis resumed after a worker restart."
                        available_at = now + 2
                    else:
                        status = "failed"
                        phase = "CAD analysis failed"
                        error_code = "worker_lost"
                        error = "CAD analysis stopped unexpectedly."
                        available_at = now
                    connection.execute(
                        """
                        UPDATE quote_analysis_parts
                        SET status=?, phase=?, error_code=?, error=?, available_at=?,
                            lease_owner=NULL, lease_expires_at=NULL, updated_at=?
                        WHERE id=?
                        """,
                        (status, phase, error_code, error, available_at, now, part["id"]),
                    )
                    recovered += 1
                for job_id in affected_jobs:
                    self._refresh_job_state(connection, job_id, now)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return recovered

    def cleanup_expired(
        self,
        storage_root: str | Path | None = None,
        thumbnail_root: str | Path | None = None,
        stl_root: str | Path | None = None,
    ) -> int:
        now = _now()
        root = (
            Path(storage_root).resolve()
            if storage_root
            else (BACKEND_ROOT / "uploads" / "quote-jobs").resolve()
        )
        thumbnail_dir = Path(thumbnail_root).resolve() if thumbnail_root else (BACKEND_ROOT / "static" / "thumbnails").resolve()
        stl_dir = Path(stl_root).resolve() if stl_root else (BACKEND_ROOT / "static" / "stl").resolve()
        self._cleanup_stale_staging(root, now)
        cleanup_candidates: list[dict[str, Any]] = []
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                expired_active = connection.execute(
                    """
                    SELECT id, status, lease_expires_at
                    FROM quote_analysis_jobs
                    WHERE expires_at<=?
                      AND status NOT IN ('completed','completed_with_errors','failed','cancelled','expired')
                    """,
                    (now,),
                ).fetchall()
                for job in expired_active:
                    connection.execute(
                        """
                        UPDATE quote_analysis_parts
                        SET status='cancelled', phase='Analysis expired',
                            error_code='quote_job_expired', error='Analysis job expired.',
                            lease_owner=NULL, lease_expires_at=NULL, updated_at=?
                        WHERE job_id=? AND status='queued'
                        """,
                        (now, job["id"]),
                    )
                    active_parts = connection.execute(
                        "SELECT COUNT(*) FROM quote_analysis_parts WHERE job_id=? AND status='analyzing'",
                        (job["id"],),
                    ).fetchone()[0]
                    extraction_active = (
                        job["status"] == "extracting"
                        and job["lease_expires_at"] is not None
                        and float(job["lease_expires_at"]) > now
                    )
                    if extraction_active or int(active_parts):
                        next_status = "cancelling"
                    else:
                        next_status = "expired"
                    connection.execute(
                        """
                        UPDATE quote_analysis_jobs
                        SET cancel_requested=1, status=?, updated_at=?, version=version+1
                        WHERE id=?
                        """,
                        (next_status, now, job["id"]),
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

            jobs = connection.execute(
                """
                SELECT id, archive_path
                FROM quote_analysis_jobs
                WHERE expires_at<=?
                  AND status IN ('completed','completed_with_errors','failed','cancelled','expired')
                """,
                (now,),
            ).fetchall()
            for job in jobs:
                part_rows = connection.execute(
                    "SELECT stored_path, file_id FROM quote_analysis_parts WHERE job_id=?",
                    (job["id"],),
                ).fetchall()
                cleanup_candidates.append(
                    {
                        "id": str(job["id"]),
                        "archive_path": str(job["archive_path"]),
                        "stored_paths": [str(row["stored_path"]) for row in part_rows],
                        "file_ids": [str(row["file_id"]) for row in part_rows],
                    }
                )

        artifact_cleaned_ids = [
            job["id"]
            for job in cleanup_candidates
            if self._remove_job_artifacts(job, root, thumbnail_dir, stl_dir)
        ]
        deleted = 0
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                for job_id in artifact_cleaned_ids:
                    cursor = connection.execute(
                        """
                        DELETE FROM quote_analysis_jobs
                        WHERE id=? AND expires_at<=?
                          AND status IN ('completed','completed_with_errors','failed','cancelled','expired')
                        """,
                        (job_id, now),
                    )
                    deleted += max(0, cursor.rowcount)
                connection.execute(
                    "DELETE FROM quote_worker_heartbeats WHERE heartbeat_at<?",
                    (now - 86400,),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return deleted

    def _cleanup_stale_staging(self, root: Path, now: float) -> None:
        raw_age = os.environ.get(
            "QUOTE_STAGING_CLEANUP_AGE_SECONDS",
            str(DEFAULT_STAGING_CLEANUP_AGE_SECONDS),
        )
        try:
            configured_age = int(raw_age)
        except (TypeError, ValueError):
            configured_age = DEFAULT_STAGING_CLEANUP_AGE_SECONDS
        minimum_age = max(MIN_STAGING_CLEANUP_AGE_SECONDS, configured_age)
        cutoff = now - minimum_age
        staging_dir = root / ".staging"
        if staging_dir.is_symlink():
            return
        try:
            candidates = list(staging_dir.iterdir())
        except OSError:
            return
        for candidate in candidates:
            if not STAGING_UPLOAD_PATTERN.fullmatch(candidate.name):
                continue
            try:
                metadata = candidate.lstat()
            except OSError:
                continue
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_mtime > cutoff:
                continue
            _remove_file_and_verify(candidate)
        try:
            staging_dir.rmdir()
        except OSError:
            pass

    def _remove_job_artifacts(
        self,
        job: dict[str, Any],
        root: Path,
        thumbnail_dir: Path,
        stl_dir: Path,
    ) -> bool:
        try:
            job_id = str(job["id"])
            if not job_id or Path(job_id).name != job_id or job_id in {".", ".."}:
                return False
            raw_job_dir = root / job_id
            if raw_job_dir.is_symlink():
                return False
            job_dir = raw_job_dir.resolve()
            stored_paths = [
                Path(path).resolve()
                for path in [job["archive_path"], *job["stored_paths"]]
            ]
        except (OSError, RuntimeError, TypeError, ValueError):
            return False
        if job_dir == root or not _is_within(job_dir, root):
            return False
        if any(not _is_within(path, job_dir) for path in stored_paths):
            return False
        try:
            if job_dir.is_symlink():
                job_dir.unlink()
            elif job_dir.exists():
                shutil.rmtree(job_dir)
        except OSError:
            return False
        if _exists_or_symlink(job_dir):
            return False

        artifact_paths: set[Path] = set()
        for file_id in job["file_ids"]:
            try:
                safe_id = str(uuid.UUID(file_id))
            except (ValueError, AttributeError):
                continue
            try:
                artifact_paths.update(thumbnail_dir.glob(f"{safe_id}_*.png"))
            except OSError:
                return False
            artifact_paths.add(thumbnail_dir / f"{safe_id}.png")
            artifact_paths.add(stl_dir / f"{safe_id}.stl")
        return all(_remove_file_and_verify(path) for path in artifact_paths)

    def _authenticated_row(self, connection: sqlite3.Connection, job_id: str, token: str) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM quote_analysis_jobs WHERE id=?",
            (job_id,),
        ).fetchone()
        if row is None:
            raise QuoteJobNotFound("Analysis job was not found.")
        if not hmac.compare_digest(row["token_hash"], _token_hash(token)):
            raise QuoteJobUnauthorized("Invalid analysis job token.")
        if float(row["expires_at"]) <= _now():
            raise QuoteJobExpired("Analysis job has expired.")
        return row

    def _job_internal(self, job_id: str) -> dict[str, Any]:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM quote_analysis_jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if row is None:
                raise QuoteJobNotFound("Analysis job was not found.")
            return dict(row)

    def _part_internal(self, part_id: str) -> dict[str, Any]:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT p.*, j.site, j.cancel_requested, j.status AS job_status
                FROM quote_analysis_parts p
                JOIN quote_analysis_jobs j ON j.id=p.job_id
                WHERE p.id=?
                """,
                (part_id,),
            ).fetchone()
            if row is None:
                raise QuoteJobNotFound("Analysis part was not found.")
            return dict(row)

    def _refresh_job_state(self, connection: sqlite3.Connection, job_id: str, now: float) -> None:
        job = connection.execute(
            "SELECT cancel_requested FROM quote_analysis_jobs WHERE id=?",
            (job_id,),
        ).fetchone()
        if job is None:
            return
        rows = connection.execute(
            "SELECT status, COUNT(*) AS count FROM quote_analysis_parts WHERE job_id=? GROUP BY status",
            (job_id,),
        ).fetchall()
        counts = {row["status"]: int(row["count"]) for row in rows}
        active = sum(counts.get(state, 0) for state in ("queued", "analyzing"))
        if job["cancel_requested"]:
            status = "cancelling" if counts.get("analyzing", 0) else "cancelled"
        elif active:
            status = "analyzing"
        elif counts.get("ready", 0) and not counts.get("failed", 0) and not counts.get("cancelled", 0):
            status = "completed"
        elif counts.get("ready", 0):
            status = "completed_with_errors"
        elif counts:
            status = "failed"
        else:
            status = "failed"
        connection.execute(
            "UPDATE quote_analysis_jobs SET status=?, updated_at=?, version=version+1 WHERE id=?",
            (status, now, job_id),
        )

    def _snapshot_with_connection(self, connection: sqlite3.Connection, job_id: str) -> dict[str, Any]:
        job = connection.execute(
            "SELECT * FROM quote_analysis_jobs WHERE id=?",
            (job_id,),
        ).fetchone()
        if job is None:
            raise QuoteJobNotFound("Analysis job was not found.")
        part_rows = connection.execute(
            "SELECT * FROM quote_analysis_parts WHERE job_id=? ORDER BY position, id",
            (job_id,),
        ).fetchall()
        counts = {
            "total": len(part_rows),
            "queued": 0,
            "analyzing": 0,
            "ready": 0,
            "failed": 0,
            "cancelled": 0,
        }
        parts: list[dict[str, Any]] = []
        for row in part_rows:
            if row["status"] in counts:
                counts[row["status"]] += 1
            parts.append(
                {
                    "id": row["id"],
                    "position": int(row["position"]),
                    "source_filename": row["source_filename"],
                    "source_format": row["source_format"],
                    "file_id": row["file_id"],
                    "size": int(row["size"]),
                    "status": row["status"],
                    "phase": row["phase"],
                    "attempt_count": int(row["attempt_count"]),
                    "analysis": _json_load(row["analysis_json"], None),
                    "warnings": _json_load(row["warnings_json"], []),
                    "error_code": row["error_code"],
                    "error": row["error"],
                }
            )
        etag = f'W/"quote-job-{job_id}-{int(job["version"])}"'
        return {
            "job": {
                "id": job["id"],
                "status": job["status"],
                "version": int(job["version"]),
                "counts": counts,
                "warnings": _json_load(job["warnings_json"], []),
                "error_code": job["error_code"],
                "error": job["error"],
                "created_at": _iso(job["created_at"]),
                "updated_at": _iso(job["updated_at"]),
                "expires_at": _iso(job["expires_at"]),
            },
            "parts": parts,
            "poll_after_ms": 1000,
            "etag": etag,
        }
