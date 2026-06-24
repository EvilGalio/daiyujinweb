from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from api_utils import api_error, api_ok
from database import init_db, shutdown_session
from services.freight import calculate_freight, get_countries, get_freight_summary
from services.pricing import calculate_quote, get_quote_options, recalculate_weight, request_formal_quote
from services.tolerance import calculate_tolerance, get_tolerance_presets, get_tolerance_zones, get_tolerance_capabilities


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_ROOT / "uploads"
THUMBNAIL_DIR = BACKEND_ROOT / "static" / "thumbnails"
def _occ_python_path():
    env_file = BACKEND_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("OCC_PYTHON="):
                return Path(line.split("=", 1)[1].strip())
    return Path(os.environ.get("OCC_PYTHON", r"D:\anaconda\envs\occ\python.exe"))

DEFAULT_OCC_PYTHON = _occ_python_path()


def _cors_origins():
    raw = os.environ.get("ALLOWED_ORIGINS", "*")
    if raw.strip() == "*":
        return "*"
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


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

    @app.post("/api/public/quote/upload")
    def quote_upload():
        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            return api_error("missing_file", "No STEP file uploaded", 400)

        suffix = Path(uploaded.filename).suffix.lower()
        if suffix not in {".stp", ".step"}:
            return api_error("invalid_file_type", "Only .stp and .step files are supported", 400)

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
        file_id = str(uuid.uuid4())
        saved_path = UPLOAD_DIR / f"{file_id}{suffix}"
        uploaded.save(saved_path)

        occ_python = Path(os.environ.get("OCC_PYTHON", str(DEFAULT_OCC_PYTHON)))
        if not occ_python.exists():
            return api_error("occ_python_missing", f"OCC Python not found: {occ_python}", 500)

        completed = subprocess.run(
            [
                str(occ_python),
                "-m",
                "scripts.analyze_step_cli",
                str(saved_path),
                str(THUMBNAIL_DIR),
            ],
            cwd=BACKEND_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=90,
            check=False,
        )
        if completed.returncode != 0:
            return api_error("step_analysis_failed", completed.stderr.strip() or completed.stdout.strip(), 500)

        analysis = json.loads(completed.stdout)
        if analysis.get("success") and analysis.get("data"):
            analysis["data"]["name"] = Path(uploaded.filename).stem
            analysis["data"]["stored_name"] = saved_path.stem
        if analysis.get("success") and analysis.get("data", {}).get("thumbnail_path"):
            thumbnail_name = Path(analysis["data"]["thumbnail_path"]).name
            analysis["data"]["thumbnail_url"] = f"/static/thumbnails/{thumbnail_name}"
        analysis["file_id"] = file_id
        return api_ok(analysis)

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
        try:
            result = calculate_quote(
                payload,
                client_ip=request.remote_addr,
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

    init_db()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
