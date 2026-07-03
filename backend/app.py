from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from flask import Flask, jsonify, request
from flask_cors import CORS

from api_utils import api_error, api_ok
from database import init_db, shutdown_session
from services.freight import calculate_freight, get_countries, get_freight_summary
from services.pricing import calculate_quote, get_quote_options, recalculate_weight, request_formal_quote
from services.tolerance import calculate_tolerance, get_tolerance_presets, get_tolerance_zones, get_tolerance_capabilities
from services.material_standards import search as material_standards_search, get_families as material_standards_families
from services.material_weight import get_options as material_weight_options, calculate as material_weight_calculate
from services.cad_analyzer import SUPPORTED_CAD_EXTENSIONS, cad_format_for_path
from services.exchange_rates import ensure_recent_rates


from services.preview_watermark import apply_preview_watermark
from services.settings import get_public_settings

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_ROOT / "uploads"
THUMBNAIL_DIR = BACKEND_ROOT / "static" / "thumbnails"
SUPPORTED_UPLOAD_EXTENSIONS = SUPPORTED_CAD_EXTENSIONS | {".zip"}
MAX_DIRECT_CAD_BYTES = 50 * 1024 * 1024
MAX_ZIP_BYTES = 50 * 1024 * 1024
MAX_ZIP_CAD_TOTAL_BYTES = 150 * 1024 * 1024
MAX_ZIP_CAD_FILES = 20

# ── Preview watermark ──────────────────────────

def _find_uploaded_cad(file_id: str) -> Path | None:
    """Find an uploaded CAD file by file_id. Supports both legacy {uuid}.ext and new {uuid}_name.ext."""
    safe = Path(file_id).name
    for ext in (".stp", ".step", ".igs", ".iges"):
        legacy = UPLOAD_DIR / f"{safe}{ext}"
        if legacy.exists():
            return legacy
        matches = sorted(UPLOAD_DIR.glob(f"{safe}_*{ext}"))
        if matches:
            return matches[0]
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
    return "Supported file types: .stp, .step, .igs, .iges, .zip"


def _run_cad_analysis(app: Flask, saved_path: Path, display_name: str, source_filename: str | None = None, site: str = "default") -> dict:
    occ_python = Path(os.environ.get("OCC_PYTHON", str(DEFAULT_OCC_PYTHON)))
    if not occ_python.exists():
        return {
            "success": False,
            "error": f"OCC Python not found: {occ_python}",
        }

    completed = subprocess.run(
        [
            str(occ_python),
            "-m",
            "scripts.analyze_cad_cli",
            str(saved_path),
            str(THUMBNAIL_DIR),
            site,
        ],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=90,
        check=False,
    )

    try:
        analysis = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
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


def _save_direct_cad(uploaded, suffix: str) -> tuple[str, Path]:
    file_id = str(uuid.uuid4())
    # Safe filename: keep original name, sanitize path separators
    safe_name = uploaded.filename.replace("\\", "_").replace("/", "_").replace(":", "_")[:120]
    saved_path = UPLOAD_DIR / f"{file_id}_{safe_name}"
    uploaded.save(saved_path)
    return file_id, saved_path


def _is_unsafe_zip_name(name: str) -> bool:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    return (
        not normalized
        or normalized.startswith("/")
        or any(part in {"", ".", ".."} for part in path.parts)
    )


def _cad_zip_members(zf: zipfile.ZipFile) -> tuple[list[zipfile.ZipInfo], list[str]]:
    warnings: list[str] = []
    members: list[zipfile.ZipInfo] = []
    total_size = 0

    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        if info.is_dir() or name.startswith("__MACOSX/"):
            continue
        if _is_unsafe_zip_name(name):
            raise ValueError(f"Unsafe ZIP entry path: {info.filename}")

        suffix = PurePosixPath(name).suffix.lower()
        if suffix == ".zip":
            warnings.append(f"Nested ZIP ignored: {info.filename}")
            continue
        if suffix not in SUPPORTED_CAD_EXTENSIONS:
            warnings.append(f"Unsupported file ignored: {info.filename}")
            continue
        if info.file_size <= 0:
            warnings.append(f"Empty CAD file ignored: {info.filename}")
            continue
        if info.file_size > MAX_DIRECT_CAD_BYTES:
            warnings.append(f"CAD file over 50 MB ignored: {info.filename}")
            continue

        total_size += info.file_size
        if len(members) >= MAX_ZIP_CAD_FILES:
            warnings.append(f"CAD file limit reached; ignored: {info.filename}")
            continue
        if total_size > MAX_ZIP_CAD_TOTAL_BYTES:
            raise ValueError("ZIP CAD contents exceed the 150 MB extracted-size limit")
        members.append(info)

    return members, warnings


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
    CORS(app, resources={r"/api/*": {"origins": _cors_origins()}})
    app.teardown_appcontext(shutdown_session)

    @app.errorhandler(404)
    def not_found(error):
        return api_error("not_found", "The requested API endpoint was not found", 404)

    @app.errorhandler(405)
    def method_not_allowed(error):
        return api_error("method_not_allowed", "This API endpoint does not support that method", 405)

    @app.errorhandler(Exception)
    def unhandled_error(error):
        app.logger.exception("Unhandled API error")
        return api_error("internal_error", "Unexpected server error", 500)

    @app.get("/api/health")
    def health():
        return api_ok(
            ok=True,
            service="daiyujin-precision-tools",
            phase="phase-1a",
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
        return api_ok({"presets": get_tolerance_presets()})

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
                "code": exc.code,
                "message": str(exc),
                "details": exc.details,
            }), 400
        except ValueError as exc:
            return api_error("invalid_tolerance_request", str(exc), 400)
        return api_ok(result)

    # ── Material Standards ──
    @app.get("/api/public/material-standards/search")
    def material_standards_search_route():
        q = request.args.get("q", "")
        limit = int(request.args.get("limit", 10))
        return api_ok(material_standards_search(q, limit))

    @app.get("/api/public/material-standards/families")
    def material_standards_families_route():
        return api_ok(material_standards_families())

    # ── Material Weight ──
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

    @app.post("/api/public/quote/upload")
    def quote_upload():
        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            return api_error("missing_file", "No CAD file uploaded", 400)
        site = _site_from_request(request, request.form.get("site") or request.form.get("theme"))

        suffix = Path(uploaded.filename).suffix.lower()
        if suffix not in SUPPORTED_UPLOAD_EXTENSIONS:
            return api_error("invalid_file_type", _supported_upload_message(), 400)
        if request.content_length and suffix == ".zip" and request.content_length > MAX_ZIP_BYTES + 1024 * 1024:
            return api_error("file_too_large", "ZIP uploads are limited to 50 MB.", 400)
        if request.content_length and suffix != ".zip" and request.content_length > MAX_DIRECT_CAD_BYTES + 1024 * 1024:
            return api_error("file_too_large", "CAD uploads are limited to 50 MB each.", 400)

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)

        if suffix == ".zip":
            try:
                uploaded.stream.seek(0)
                with zipfile.ZipFile(uploaded.stream) as zf:
                    members, warnings = _cad_zip_members(zf)
                    if not members:
                        return api_error("invalid_archive", "ZIP archive does not contain supported CAD files.", 400)

                    parts = []
                    for info in members:
                        inner_name = info.filename.replace("\\", "/")
                        inner_suffix = PurePosixPath(inner_name).suffix.lower()
                        file_id = str(uuid.uuid4())
                        safe_inner = PurePosixPath(inner_name).name.replace("\\", "_").replace("/", "_").replace(":", "_")[:120]
                        saved_path = UPLOAD_DIR / f"{file_id}_{safe_inner}"
                        with zf.open(info) as src, saved_path.open("wb") as dst:
                            shutil.copyfileobj(src, dst)

                        analysis = _run_cad_analysis(app, saved_path, PurePosixPath(inner_name).name, inner_name, site=site)
                        analysis["file_id"] = file_id
                        part = {
                            "success": bool(analysis.get("success")),
                            "file_id": file_id,
                            "source_filename": inner_name,
                            "source_format": analysis.get("source_format"),
                            "warnings": analysis.get("warnings", []),
                        }
                        if analysis.get("success"):
                            part["data"] = analysis.get("data")
                        else:
                            part["error"] = analysis.get("error") or "CAD analysis failed"
                        parts.append(part)
            except zipfile.BadZipFile:
                return api_error("invalid_archive", "ZIP archive could not be read.", 400)
            except ValueError as exc:
                return api_error("invalid_archive", str(exc), 400)

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

        file_id, saved_path = _save_direct_cad(uploaded, suffix)
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
        return api_ok(get_quote_options())

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
    threading.Thread(target=_refresh_exchange_rates_if_stale, daemon=True).start()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
