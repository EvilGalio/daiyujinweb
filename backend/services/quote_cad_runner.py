from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from services.cad_analyzer import cad_format_for_path
from services.preview_watermark import apply_preview_watermark


DEFAULT_TIMEOUT_SECONDS = 90
DEFAULT_PREVIEW_WIDTH = 1280
DEFAULT_PREVIEW_HEIGHT = 720


def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
            text=True,
        )
    else:
        process.kill()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def _safe_failure(code: str, message: str, *, source_filename: str, source_format: str) -> dict[str, Any]:
    return {
        "success": False,
        "data": None,
        "warnings": [],
        "error_code": code,
        "error": message,
        "source_filename": source_filename,
        "source_format": source_format,
    }


def parse_cli_payload(stdout: str) -> dict[str, Any]:
    candidates = [stdout.strip(), *reversed(stdout.splitlines())]
    for candidate in candidates:
        if not candidate.strip():
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return {}


def run_cad_analysis(
    *,
    backend_root: str | Path,
    occ_python: str | Path,
    saved_path: str | Path,
    display_name: str,
    source_filename: str,
    file_id: str,
    thumbnail_dir: str | Path,
    site: str = "default",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    preview_width: int = DEFAULT_PREVIEW_WIDTH,
    preview_height: int = DEFAULT_PREVIEW_HEIGHT,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    backend = Path(backend_root).resolve()
    python_path = Path(occ_python).resolve()
    cad_path = Path(saved_path).resolve()
    thumbnails = Path(thumbnail_dir).resolve()
    source_format = cad_format_for_path(cad_path)

    if not python_path.is_file():
        return _safe_failure(
            "occ_missing",
            "CAD analysis is temporarily unavailable.",
            source_filename=source_filename,
            source_format=source_format,
        )

    thumbnails.mkdir(parents=True, exist_ok=True)
    child_env = os.environ.copy()
    child_env["QUOTE_PREVIEW_WIDTH"] = str(preview_width)
    child_env["QUOTE_PREVIEW_HEIGHT"] = str(preview_height)
    existing_python_path = child_env.get("PYTHONPATH", "")
    child_env["PYTHONPATH"] = str(backend) + (os.pathsep + existing_python_path if existing_python_path else "")
    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [
            str(python_path),
            "-B",
            "-m",
            "scripts.analyze_cad_cli",
            str(cad_path),
            str(thumbnails),
            site,
        ],
        cwd=cad_path.parent,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_env,
        creationflags=creation_flags,
    )
    started_at = time.monotonic()
    timeout_limit = max(1, timeout_seconds)
    while True:
        if cancel_event is not None and cancel_event.is_set():
            _terminate_process_tree(process)
            return _safe_failure(
                "cad_cancelled",
                "CAD analysis was cancelled.",
                source_filename=source_filename,
                source_format=source_format,
            )
        remaining = timeout_limit - (time.monotonic() - started_at)
        if remaining <= 0:
            _terminate_process_tree(process)
            return _safe_failure(
                "cad_timeout",
                "CAD analysis timed out. You can retry this part.",
                source_filename=source_filename,
                source_format=source_format,
            )
        try:
            stdout, stderr = process.communicate(timeout=min(0.25, remaining))
            break
        except subprocess.TimeoutExpired:
            continue

    result = parse_cli_payload(stdout)

    if process.returncode != 0 or not result.get("success") or not isinstance(result.get("data"), dict):
        code = "cad_parse_failed" if result.get("error") else "cad_process_failed"
        return _safe_failure(
            code,
            "This CAD file could not be analyzed. You can retry it or upload another export.",
            source_filename=source_filename,
            source_format=source_format,
        )

    data = dict(result["data"])
    data["name"] = Path(display_name).stem
    data["stored_name"] = cad_path.stem
    data["source_filename"] = source_filename
    data["source_format"] = source_format
    warnings = list(result.get("warnings") or [])
    thumbnail_value = data.get("thumbnail_path")
    if thumbnail_value:
        thumbnail_path = Path(str(thumbnail_value))
        if thumbnail_path.exists():
            data["thumbnail_url"] = f"/static/thumbnails/{thumbnail_path.name}"
            if not apply_preview_watermark(thumbnail_path, site=site):
                warnings.append("Preview watermark could not be applied.")
        else:
            data["thumbnail_path"] = None
            data["thumbnail_url"] = None
            warnings.append("Preview image was not generated.")
    data.pop("thumbnail_path", None)

    return {
        "success": True,
        "file_id": file_id,
        "data": data,
        "warnings": warnings,
        "error_code": None,
        "error": None,
        "source_filename": source_filename,
        "source_format": source_format,
    }
