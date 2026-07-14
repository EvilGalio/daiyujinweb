from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from api_utils import api_error, api_ok
from database import init_db, shutdown_session
from services.freight import calculate_freight, get_countries, get_freight_summary
from services.pricing import calculate_quote, get_quote_options, recalculate_weight, request_formal_quote
from services.tolerance import calculate_tolerance, get_tolerance_presets, get_tolerance_zones, get_tolerance_capabilities
from services.material_standards import search as material_standards_search, get_families as material_standards_families
from services.material_weight import get_options as material_weight_options, calculate as material_weight_calculate
from services.cad_analyzer import SUPPORTED_CAD_EXTENSIONS, cad_format_for_path
from services.archive_reader import (
    ArchiveDependencyError,
    ArchiveReadError,
    SUPPORTED_ARCHIVE_EXTENSIONS,
    extract_cad_members,
    list_cad_members,
)
from services.exchange_rates import ensure_recent_rates
from services.quote_jobs import (
    QuoteJobCapacityError,
    QuoteJobConflict,
    QuoteJobExpired,
    QuoteJobInvalidState,
    QuoteJobNotFound,
    QuoteJobStore,
    QuoteJobUnauthorized,
)
from services.quote_cad_runner import parse_cli_payload


from services.preview_watermark import apply_preview_watermark
from services.settings import get_public_settings
from services.portal_auth import portal_bp

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_ROOT / "uploads"
THUMBNAIL_DIR = BACKEND_ROOT / "static" / "thumbnails"
SUPPORTED_UPLOAD_EXTENSIONS = SUPPORTED_CAD_EXTENSIONS | SUPPORTED_ARCHIVE_EXTENSIONS
MAX_DIRECT_CAD_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_PORTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024
MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
MAX_QUOTE_UPLOAD_REQUEST_BYTES = MAX_ARCHIVE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
MAX_UPLOAD_REQUEST_BYTES = MAX_PORTAL_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
MAX_ARCHIVE_CAD_TOTAL_BYTES = 150 * 1024 * 1024
MAX_ARCHIVE_CAD_FILES = 50
QUOTE_JOB_STORAGE_ROOT = Path(os.environ.get("QUOTE_JOB_STORAGE_ROOT", UPLOAD_DIR / "quote-jobs")).resolve()
QUOTE_JOB_MAINTENANCE_FILE = Path(
    os.environ.get("QUOTE_JOB_MAINTENANCE_FILE", BACKEND_ROOT / "data" / "quote-async-maintenance.flag")
).resolve()
QUOTE_JOB_MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024
QUOTE_JOB_UPLOAD_LOCKS = [threading.Lock() for _ in range(64)]
quote_job_store = QuoteJobStore()


class UploadTooLargeError(ValueError):
    pass


# Preview watermark

def _find_uploaded_cad(file_id: str) -> Path | None:
    """Find an uploaded CAD file by file_id. Supports both legacy {uuid}.ext and new {uuid}_name.ext."""
    safe = Path(file_id).name
    try:
        if str(uuid.UUID(safe)) != safe.lower():
            return None
    except ValueError:
        return None
    for ext in (".stp", ".step", ".igs", ".iges"):
        legacy = UPLOAD_DIR / f"{safe}{ext}"
        if legacy.exists():
            return legacy
        matches = sorted(UPLOAD_DIR.glob(f"{safe}_*{ext}"))
        if matches:
            return matches[0]
        async_matches = sorted(QUOTE_JOB_STORAGE_ROOT.glob(f"*/parts/{safe}_*{ext}"))
        if async_matches:
            return async_matches[0]
    return None


def _client_real_ip(request) -> str:
    return (
        request.headers.get("CF-Connecting-IP")
        or (request.headers.get("X-Forwarded-For", "").split(",")[0].strip())
        or request.remote_addr
        or ""
    )


def _normalize_site(site: str | None) -> str:
    value = str(site or "").strip().lower()
    return value if value in {"default", "mfg", "gcindus", "gcnov"} else ""


def _site_from_request_origin(request) -> str:
    source = request.headers.get("Origin") or request.headers.get("Referer") or ""
    host = urlparse(source).netloc.lower()
    if "mfg-solution.com" in host:
        return "mfg"
    if "gcindus.com" in host:
        return "gcindus"
    if "gcnov.com" in host:
        return "gcnov"
    return ""


def _site_from_request(request, candidate: str | None = None) -> str:
    site = _normalize_site(candidate)
    origin_site = _site_from_request_origin(request)
    if origin_site and site in {"", "default"}:
        return origin_site
    return site or origin_site or "default"


def _occ_python_path():
    env_file = BACKEND_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("OCC_PYTHON="):
                return Path(line.split("=", 1)[1].strip())
    return Path(os.environ.get("OCC_PYTHON", r"D:\anaconda\envs\occ\python.exe"))

DEFAULT_OCC_PYTHON = _occ_python_path()


def _supported_upload_message() -> str:
    return "Supported file types: .stp, .step, .igs, .iges, .zip, .rar, .7z"


def _run_cad_analysis(app: Flask, saved_path: Path, display_name: str, source_filename: str | None = None, site: str = "default") -> dict:
    occ_python = Path(os.environ.get("OCC_PYTHON", str(DEFAULT_OCC_PYTHON)))
    if not occ_python.exists():
        return {
            "success": False,
            "error": f"OCC Python not found: {occ_python}",
        }

    child_env = os.environ.copy()
    existing_python_path = child_env.get("PYTHONPATH", "")
    child_env["PYTHONPATH"] = str(BACKEND_ROOT) + (os.pathsep + existing_python_path if existing_python_path else "")
    completed = subprocess.run(
        [
            str(occ_python),
            "-m",
            "scripts.analyze_cad_cli",
            str(saved_path),
            str(THUMBNAIL_DIR),
            site,
        ],
        cwd=saved_path.parent,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=90,
        check=False,
        env=child_env,
    )

    analysis = parse_cli_payload(completed.stdout or "")
    if not analysis:
        analysis = {
            "success": False,
            "data": None,
            "warnings": [],
            "error": completed.stderr.strip() or completed.stdout.strip() or "CAD analysis failed",
        }

    if completed.returncode != 0 and not analysis.get("error"):
        analysis["error"] = completed.stderr.strip() or "CAD analysis failed"

    if analysis.get("success") and analysis.get("data"):
        analysis["data"]["name"] = Path(display_name).stem
        analysis["data"]["stored_name"] = saved_path.stem
        analysis["data"]["source_filename"] = source_filename or display_name
        analysis["data"]["source_format"] = cad_format_for_path(saved_path)

        if analysis["data"].get("thumbnail_path"):
            thumbnail_name = Path(analysis["data"]["thumbnail_path"]).name
            analysis["data"]["thumbnail_url"] = f"/static/thumbnails/{thumbnail_name}"
            thumb_path = Path(analysis["data"]["thumbnail_path"])
            if thumb_path.exists() and not apply_preview_watermark(thumb_path, site=site):
                app.logger.warning("Preview watermark was not applied for %s", thumb_path.name)

    analysis["source_filename"] = source_filename or display_name
    analysis["source_format"] = cad_format_for_path(saved_path)
    return analysis


def _save_bounded_upload(uploaded, destination: Path, max_bytes: int, message: str) -> int:
    size = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = uploaded.stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise UploadTooLargeError(message)
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return size


def _save_direct_cad(uploaded, suffix: str) -> tuple[str, Path]:
    file_id = str(uuid.uuid4())
    # Safe filename: keep original name, sanitize path separators
    safe_name = uploaded.filename.replace("\\", "_").replace("/", "_").replace(":", "_")[:120]
    saved_path = UPLOAD_DIR / f"{file_id}_{safe_name}"
    _save_bounded_upload(
        uploaded,
        saved_path,
        MAX_DIRECT_CAD_BYTES,
        "CAD uploads are limited to 50 MB each.",
    )
    return file_id, saved_path


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _quote_job_credentials() -> tuple[str, str]:
    job_id = request.headers.get("Idempotency-Key", "").strip().lower()
    token = request.headers.get("X-Quote-Job-Token", "").strip()
    try:
        parsed_id = uuid.UUID(job_id)
    except (ValueError, AttributeError) as exc:
        raise ValueError("Idempotency-Key must be a UUID.") from exc
    if str(parsed_id) != job_id:
        raise ValueError("Idempotency-Key must use canonical UUID formatting.")
    try:
        token_bytes = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    except (ValueError, binascii.Error) as exc:
        raise ValueError("X-Quote-Job-Token is invalid.") from exc
    if len(token_bytes) != 32:
        raise ValueError("X-Quote-Job-Token must contain 32 random bytes.")
    return job_id, token


def _quote_job_token() -> str:
    token = request.headers.get("X-Quote-Job-Token", "").strip()
    if not token:
        raise ValueError("X-Quote-Job-Token is required.")
    return token


def _client_ip_hash() -> str:
    value = _client_real_ip(request)
    if not value:
        return ""
    salt = os.environ.get("QUOTE_CLIENT_HASH_SALT", "daiyujin-quote-rate-limit")
    return hashlib.sha256(f"{salt}:{value}".encode("utf-8")).hexdigest()


def _archive_signature_matches(path: Path, suffix: str) -> bool:
    with path.open("rb") as stream:
        header = stream.read(8)
    if suffix == ".zip":
        return header.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"))
    if suffix == ".rar":
        return header.startswith((b"Rar!\x1a\x07\x00", b"Rar!\x1a\x07\x01"))
    if suffix == ".7z":
        return header.startswith(b"7z\xbc\xaf\x27\x1c")
    return False


def _file_matches_upload(path: Path, expected_sha256: str, expected_size: int) -> bool:
    try:
        if not path.is_file() or path.stat().st_size != expected_size:
            return False
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return hmac.compare_digest(digest.hexdigest(), expected_sha256)
    except OSError:
        return False


def _save_quote_archive(uploaded, job_id: str, suffix: str) -> tuple[Path, str, int]:
    staging_dir = QUOTE_JOB_STORAGE_ROOT / ".staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    temp_path = staging_dir / f"upload-{job_id}-{uuid.uuid4().hex}.part"
    digest = hashlib.sha256()
    size = 0
    try:
        with temp_path.open("wb") as destination:
            while True:
                chunk = uploaded.stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise UploadTooLargeError("Archive uploads are limited to 50 MB.")
                digest.update(chunk)
                destination.write(chunk)
        if size <= 0:
            raise ValueError("The uploaded archive is empty.")
        if not _archive_signature_matches(temp_path, suffix):
            raise ValueError("The file signature does not match the selected archive type.")
        return temp_path, digest.hexdigest(), size
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _quote_job_response(snapshot: dict, status: int = 200):
    payload = {key: value for key, value in snapshot.items() if key != "etag"}
    payload["error"] = False
    response = jsonify(payload)
    response.status_code = status
    if snapshot.get("etag"):
        response.headers["ETag"] = snapshot["etag"]
    response.headers["Cache-Control"] = "no-store"
    return response


def _quote_job_exception(error: Exception):
    if isinstance(error, QuoteJobNotFound):
        return api_error("quote_job_not_found", str(error), 404)
    if isinstance(error, QuoteJobExpired):
        return api_error("quote_job_expired", str(error), 410)
    if isinstance(error, QuoteJobUnauthorized):
        return api_error("quote_job_unauthorized", str(error), 403)
    if isinstance(error, QuoteJobConflict):
        return api_error("quote_job_conflict", str(error), 409)
    if isinstance(error, QuoteJobCapacityError):
        response, status = api_error("quote_queue_full", str(error), 429)
        response.headers["Retry-After"] = "15"
        return response, status
    if isinstance(error, QuoteJobInvalidState):
        return api_error("quote_job_invalid_state", str(error), 409)
    raise error


def _refresh_exchange_rates_if_stale() -> None:
    try:
        ensure_recent_rates(max_age_hours=30)
    except Exception:
        pass


def _cors_origins():
    raw = os.environ.get("ALLOWED_ORIGINS", "*")
    if raw.strip() == "*":
        return "*"
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_REQUEST_BYTES
    CORS(
        app,
        resources={r"/api/*": {"origins": _cors_origins()}},
        expose_headers=["ETag", "Retry-After"],
    )
    app.register_blueprint(portal_bp)
    app.teardown_appcontext(shutdown_session)

    @app.errorhandler(404)
    def not_found(error):
        return api_error("not_found", "The requested API endpoint was not found", 404)

    @app.errorhandler(405)
    def method_not_allowed(error):
        return api_error("method_not_allowed", "This API endpoint does not support that method", 405)

    @app.errorhandler(RequestEntityTooLarge)
    def request_entity_too_large(error):
        return api_error("file_too_large", "The upload request exceeds the server limit.", 413)

    @app.errorhandler(Exception)
    def unhandled_error(error):
        app.logger.exception("Unhandled API error")
        return api_error("internal_error", "Unexpected server error", 500)

    @app.get("/api/health")
    def health():
        async_enabled = _env_enabled("QUOTE_ASYNC_ARCHIVES_ENABLED", False)
        worker = (
            quote_job_store.worker_health()
            if async_enabled
            else {
                "status": "disabled",
                "last_heartbeat_at": None,
                "active_parts": 0,
                "queued_parts": 0,
            }
        )
        return api_ok(
            ok=True,
            service="daiyujin-precision-tools",
            phase="phase-1a",
            quote_worker={
                "enabled": async_enabled,
                **worker,
            },
        )

    @app.get("/api/public/freight/prototype")
    def freight_prototype():
        return api_ok({"version": "dhl-v3-20260624", **get_freight_summary()})

    @app.get("/api/public/freight/countries")
    def freight_countries():
        return api_ok({"countries": get_countries()})

    @app.post("/api/public/freight/calculate")
    def freight_calculate():
        payload = request.get_json(silent=True) or {}
        try:
            country = str(payload.get("country", ""))
            weight_kg = float(payload.get("weight_kg", 0))
            currency = str(payload.get("currency", "USD"))
            result = calculate_freight(
                country=country,
                weight_kg=weight_kg,
                currency=currency,
            )
        except ValueError as exc:
            return api_error("invalid_freight_request", str(exc), 400)
        return api_ok(result)

    @app.get("/api/public/tolerance/tolerance-zones")
    def tolerance_zones():
        return api_ok({"tolerance_zones": get_tolerance_zones()})

    @app.get("/api/public/tolerance/presets")
    def tolerance_presets():
        return api_ok({"presets": get_tolerance_presets(
            standard=request.args.get("standard"),
            basis=request.args.get("basis"),
            fit_type=request.args.get("fit_type"),
        )})

    @app.get("/api/public/tolerance/capabilities")
    def tolerance_capabilities():
        return api_ok(get_tolerance_capabilities())

    @app.post("/api/public/tolerance/calculate")
    def tolerance_calculate():
        payload = request.get_json(silent=True) or {}
        try:
            from services.tolerance_engine.parser import TolError
            result = calculate_tolerance(payload)
        except TolError as exc:
            return jsonify({
                "error": True,
                "code": "invalid_tolerance_request",
                "message": str(exc),
                "details": {"reason_code": exc.code, **(exc.details or {})},
            }), 400
        except ValueError as exc:
            return api_error("invalid_tolerance_request", str(exc), 400)
        return api_ok(result)

    # Material Standards
    @app.get("/api/public/material-standards/search")
    def material_standards_search_route():
        q = request.args.get("q", "")
        limit = int(request.args.get("limit", 10))
        family = request.args.get("family")
        standard = request.args.get("standard")
        min_confidence = request.args.get("min_confidence") or request.args.get("confidence")
        return api_ok(material_standards_search(
            q,
            limit=limit,
            family=family,
            standard=standard,
            min_confidence=min_confidence,
        ))

    @app.get("/api/public/material-standards/families")
    def material_standards_families_route():
        return api_ok(material_standards_families())

    # Material Weight
    @app.get("/api/public/material-weight/options")
    def material_weight_options_route():
        return api_ok(material_weight_options())

    @app.post("/api/public/material-weight/calculate")
    def material_weight_calculate_route():
        payload = request.get_json(silent=True) or {}
        try:
            result = material_weight_calculate(payload)
        except ValueError as exc:
            return api_error("invalid_weight_request", str(exc), 400)
        return api_ok(result)

    @app.post("/api/public/quote/analysis-jobs")
    def quote_analysis_job_create():
        if not _env_enabled("QUOTE_ASYNC_ARCHIVES_ENABLED", False):
            return api_error(
                "async_archives_disabled",
                "Asynchronous archive analysis is not enabled on this server.",
                503,
            )
        if QUOTE_JOB_MAINTENANCE_FILE.is_file():
            response, status = api_error(
                "quote_analysis_maintenance",
                "CAD analysis is temporarily paused for maintenance. Please retry shortly.",
                503,
            )
            response.headers["Retry-After"] = "30"
            return response, status
        if _env_enabled("QUOTE_REQUIRE_WORKER_HEALTH", True):
            worker = quote_job_store.worker_health()
            if worker["status"] != "healthy":
                response, status = api_error(
                    "quote_worker_unavailable",
                    "CAD analysis is temporarily unavailable. Please retry shortly.",
                    503,
                )
                response.headers["Retry-After"] = "15"
                return response, status
        try:
            job_id, token = _quote_job_credentials()
        except ValueError as exc:
            return api_error("invalid_quote_job_credentials", str(exc), 400)
        if request.content_length and request.content_length > MAX_QUOTE_UPLOAD_REQUEST_BYTES:
            return api_error("file_too_large", "Archive uploads are limited to 50 MB.", 413)

        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            return api_error("missing_file", "No archive file was uploaded.", 400)
        suffix = Path(uploaded.filename).suffix.lower()
        if suffix not in SUPPORTED_ARCHIVE_EXTENSIONS:
            return api_error("invalid_file_type", "Asynchronous analysis accepts ZIP, RAR, or 7Z archives.", 400)
        QUOTE_JOB_STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
        minimum_free = max(0, int(os.environ.get("QUOTE_JOB_MIN_FREE_BYTES", str(QUOTE_JOB_MIN_FREE_BYTES))))
        if shutil.disk_usage(QUOTE_JOB_STORAGE_ROOT).free < minimum_free:
            response, status = api_error(
                "quote_storage_low",
                "CAD analysis storage is temporarily full. Please retry later.",
                503,
            )
            response.headers["Retry-After"] = "60"
            return response, status

        lock = QUOTE_JOB_UPLOAD_LOCKS[int(job_id.replace("-", ""), 16) % len(QUOTE_JOB_UPLOAD_LOCKS)]
        temp_path = None
        final_path = QUOTE_JOB_STORAGE_ROOT / job_id / f"source{suffix}"
        try:
            with lock:
                temp_path, archive_sha256, archive_size = _save_quote_archive(uploaded, job_id, suffix)
                source_filename = Path(uploaded.filename.replace("\\", "/")).name[:255] or f"archive{suffix}"
                site = _site_from_request(request, request.form.get("site") or request.form.get("theme"))
                snapshot, created = quote_job_store.create_job(
                    job_id=job_id,
                    token=token,
                    archive_sha256=archive_sha256,
                    archive_size=archive_size,
                    archive_suffix=suffix,
                    archive_path=final_path,
                    source_filename=source_filename,
                    site=site,
                    client_ip_hash=_client_ip_hash(),
                )
                needs_activation = created or snapshot["job"]["status"] == "uploading"
                if needs_activation:
                    if _file_matches_upload(final_path, archive_sha256, archive_size):
                        temp_path.unlink(missing_ok=True)
                        temp_path = None
                    else:
                        final_path.parent.mkdir(parents=True, exist_ok=True)
                        try:
                            os.replace(temp_path, final_path)
                        except OSError:
                            if created:
                                quote_job_store.abort_upload(job_id, token)
                            try:
                                final_path.parent.rmdir()
                            except OSError:
                                pass
                            raise
                        temp_path = None
                    snapshot = quote_job_store.activate_job(job_id, token)
                if temp_path is not None:
                    temp_path.unlink(missing_ok=True)
                    temp_path = None
                return _quote_job_response(snapshot, status=202)
        except UploadTooLargeError as exc:
            return api_error("file_too_large", str(exc), 413)
        except ValueError as exc:
            return api_error("invalid_archive_upload", str(exc), 400)
        except OSError:
            response, status = api_error(
                "quote_storage_write_failed",
                "The archive could not be stored. Please retry shortly.",
                503,
            )
            response.headers["Retry-After"] = "15"
            return response, status
        except (
            QuoteJobNotFound,
            QuoteJobExpired,
            QuoteJobUnauthorized,
            QuoteJobConflict,
            QuoteJobCapacityError,
            QuoteJobInvalidState,
        ) as exc:
            return _quote_job_exception(exc)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            staging_dir = QUOTE_JOB_STORAGE_ROOT / ".staging"
            try:
                staging_dir.rmdir()
            except OSError:
                pass

    @app.get("/api/public/quote/analysis-jobs/<job_id>")
    def quote_analysis_job_status(job_id: str):
        try:
            snapshot = quote_job_store.get_snapshot(job_id, _quote_job_token())
        except ValueError as exc:
            return api_error("missing_quote_job_token", str(exc), 400)
        except (QuoteJobNotFound, QuoteJobExpired, QuoteJobUnauthorized) as exc:
            return _quote_job_exception(exc)
        if request.headers.get("If-None-Match", "").strip() == snapshot.get("etag"):
            response = app.response_class(status=304)
            response.headers["ETag"] = snapshot["etag"]
            response.headers["Cache-Control"] = "no-store"
            return response
        return _quote_job_response(snapshot)

    @app.post("/api/public/quote/analysis-jobs/<job_id>/cancel")
    def quote_analysis_job_cancel(job_id: str):
        try:
            snapshot = quote_job_store.request_cancel(job_id, _quote_job_token())
            return _quote_job_response(snapshot)
        except ValueError as exc:
            return api_error("missing_quote_job_token", str(exc), 400)
        except (
            QuoteJobNotFound,
            QuoteJobExpired,
            QuoteJobUnauthorized,
            QuoteJobInvalidState,
        ) as exc:
            return _quote_job_exception(exc)

    @app.post("/api/public/quote/analysis-jobs/<job_id>/parts/<part_id>/retry")
    def quote_analysis_part_retry(job_id: str, part_id: str):
        try:
            snapshot = quote_job_store.retry_part(job_id, part_id, _quote_job_token())
            return _quote_job_response(snapshot)
        except ValueError as exc:
            return api_error("missing_quote_job_token", str(exc), 400)
        except (
            QuoteJobNotFound,
            QuoteJobExpired,
            QuoteJobUnauthorized,
            QuoteJobInvalidState,
        ) as exc:
            return _quote_job_exception(exc)

    @app.post("/api/public/quote/upload")
    def quote_upload():
        if request.content_length and request.content_length > MAX_QUOTE_UPLOAD_REQUEST_BYTES:
            return api_error("file_too_large", "CAD and archive uploads are limited to 50 MB.", 413)
        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            return api_error("missing_file", "No CAD file uploaded", 400)
        site = _site_from_request(request, request.form.get("site") or request.form.get("theme"))

        suffix = Path(uploaded.filename).suffix.lower()
        if suffix not in SUPPORTED_UPLOAD_EXTENSIONS:
            return api_error("invalid_file_type", _supported_upload_message(), 400)
        is_archive = suffix in SUPPORTED_ARCHIVE_EXTENSIONS
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)

        if is_archive:
            archive_path = UPLOAD_DIR / f"{uuid.uuid4()}{suffix}"
            try:
                _save_bounded_upload(
                    uploaded,
                    archive_path,
                    MAX_ARCHIVE_BYTES,
                    "Archive uploads are limited to 50 MB.",
                )
            except UploadTooLargeError as exc:
                return api_error("file_too_large", str(exc), 413)
            try:
                members, warnings = list_cad_members(
                    archive_path,
                    suffix,
                    cad_extensions=SUPPORTED_CAD_EXTENSIONS,
                    max_file_size=MAX_DIRECT_CAD_BYTES,
                    max_total_size=MAX_ARCHIVE_CAD_TOTAL_BYTES,
                    max_files=MAX_ARCHIVE_CAD_FILES,
                )
                if not members:
                    return api_error("invalid_archive", "Archive does not contain supported CAD files.", 400)

                extracted = extract_cad_members(archive_path, suffix, members, UPLOAD_DIR)
                parts = []
                for item in extracted:
                    inner_name = item.member.name
                    display_name = inner_name.rsplit("/", 1)[-1]
                    analysis = _run_cad_analysis(
                        app,
                        item.path,
                        display_name,
                        inner_name,
                        site=site,
                    )
                    analysis["file_id"] = item.file_id
                    part = {
                        "success": bool(analysis.get("success")),
                        "file_id": item.file_id,
                        "source_filename": inner_name,
                        "source_format": analysis.get("source_format"),
                        "warnings": analysis.get("warnings", []),
                    }
                    if analysis.get("success"):
                        part["data"] = analysis.get("data")
                    else:
                        part["error"] = analysis.get("error") or "CAD analysis failed"
                    parts.append(part)
            except ArchiveDependencyError as exc:
                return api_error("archive_support_unavailable", str(exc), 503)
            except ArchiveReadError as exc:
                return api_error("invalid_archive", str(exc), 400)
            finally:
                archive_path.unlink(missing_ok=True)

            if not any(part.get("success") for part in parts):
                return api_error(
                    "archive_analysis_failed",
                    "No CAD files in the archive could be analyzed.",
                    400,
                    details={"parts": parts, "warnings": warnings},
                )
            return api_ok({
                "success": True,
                "archive": True,
                "source_filename": uploaded.filename,
                "parts": parts,
                "warnings": warnings,
            })

        try:
            file_id, saved_path = _save_direct_cad(uploaded, suffix)
        except UploadTooLargeError as exc:
            return api_error("file_too_large", str(exc), 413)
        analysis = _run_cad_analysis(app, saved_path, uploaded.filename, uploaded.filename, site=site)
        analysis["file_id"] = file_id
        if not analysis.get("success"):
            return api_error("cad_analysis_failed", analysis.get("error") or "CAD analysis failed", 500)
        return api_ok(analysis)

    @app.get("/api/public/quote/model/<file_id>")
    def quote_model_stl(file_id):
        """Export uploaded STEP/IGES as binary STL for 3D preview."""
        safe_id = Path(file_id).name
        src = _find_uploaded_cad(safe_id)
        if not src:
            return api_error("not_found", "CAD file not found", 404)

        stl_dir = BACKEND_ROOT / "static" / "stl"
        stl_dir.mkdir(parents=True, exist_ok=True)
        stl_path = stl_dir / f"{safe_id}.stl"

        if not stl_path.exists():
            occ_py = _occ_python_path()
            if not occ_py or not occ_py.exists():
                return api_error("occ_missing", "OCC Python not found", 500)
            completed = subprocess.run(
                [str(occ_py), "-m", "scripts.export_stl_cli", str(src), str(stl_path)],
                cwd=BACKEND_ROOT, capture_output=True, text=True, timeout=60,
            )
            if completed.returncode != 0 or not stl_path.exists():
                app.logger.error(
                    "STL export failed for %s: returncode=%s stdout=%s stderr=%s",
                    safe_id,
                    completed.returncode,
                    (completed.stdout or "").strip()[:1000],
                    (completed.stderr or "").strip()[:1000],
                )
                if stl_path.exists() and stl_path.stat().st_size == 0:
                    stl_path.unlink(missing_ok=True)
                return api_error("stl_failed", "3D preview generation failed. Static preview remains available.", 500)

        from flask import send_file
        return send_file(stl_path, mimetype="model/stl", as_attachment=False,
            download_name=f"{safe_id}.stl")

    @app.get("/api/public/quote/options")
    def quote_options():
        options = dict(get_quote_options())
        options["async_archive_analysis"] = _env_enabled("QUOTE_ASYNC_ARCHIVES_ENABLED", False)
        return api_ok(options)

    @app.post("/api/public/quote/recalculate-weight")
    def quote_recalculate_weight():
        payload = request.get_json(silent=True) or {}
        try:
            result = recalculate_weight(
                volume_mm3=payload.get("volume_mm3"),
                material_id=payload.get("material_id"),
            )
        except ValueError as exc:
            return api_error("invalid_quote_request", str(exc), 400)
        return api_ok(result)

    @app.post("/api/public/quote/calculate")
    def quote_calculate():
        payload = request.get_json(silent=True) or {}
        site = _site_from_request(request, payload.get("site") or payload.get("theme"))
        payload["site"] = site
        payload["theme"] = site
        try:
            result = calculate_quote(
                payload,
                client_ip=_client_real_ip(request),
                client_country=request.headers.get("CF-IPCountry", ""),
                user_agent=request.headers.get("User-Agent"),
            )
        except ValueError as exc:
            return api_error("invalid_quote_request", str(exc), 400)
        return api_ok(result)

    @app.post("/api/public/quote/request-formal")
    def quote_request_formal():
        payload = request.get_json(silent=True) or {}
        try:
            result = request_formal_quote(
                payload,
                client_ip=request.remote_addr,
                user_agent=request.headers.get("User-Agent"),
            )
        except ValueError as exc:
            return api_error("invalid_quote_request", str(exc), 400)
        return api_ok(result)

    @app.get("/api/public/settings")
    def public_settings():
        tool = request.args.get("tool", "quote")
        site = _site_from_request(request, request.args.get("site", "default"))
        return api_ok({
            "tool": tool, "site": site,
            "settings": get_public_settings(tool=tool, site=site),
        })

    init_db()
    if _env_enabled("QUOTE_ASYNC_ARCHIVES_ENABLED", False):
        quote_job_store.init()
    threading.Thread(target=_refresh_exchange_rates_if_stale, daemon=True).start()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
