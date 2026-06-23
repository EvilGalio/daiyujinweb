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
from services.freight_importer import find_freight_workbook, parse_freight_workbook


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_ROOT / "uploads"
THUMBNAIL_DIR = BACKEND_ROOT / "static" / "thumbnails"
DEFAULT_OCC_PYTHON = Path(r"D:\anaconda\envs\occ\python.exe")


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}})
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
            phase="phase-0",
        )

    @app.get("/api/public/freight/prototype")
    def freight_prototype():
        workbook_path = find_freight_workbook(PROJECT_ROOT)
        summary = parse_freight_workbook(workbook_path, include_records=False)
        return api_ok(summary)

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

    init_db()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
