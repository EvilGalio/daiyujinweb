from __future__ import annotations

from flask import jsonify


def api_error(code: str, message: str, status: int = 400, details: dict | None = None):
    payload = {
        "error": True,
        "code": code,
        "message": message,
    }
    if details:
        payload["details"] = details
    return jsonify(payload), status


def api_ok(data: dict | None = None, **extra):
    payload = {}
    if data:
        payload.update(data)
    payload.update(extra)
    payload["error"] = False
    return jsonify(payload)
