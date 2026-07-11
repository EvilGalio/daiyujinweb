from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

from backend.scripts.phase4_inventory_legacy import inventory
from backend.scripts.phase4_inventory_r2 import reconcile_r2_inventory
from backend.scripts.phase4_inventory_runtime_storage import inventory as storage_inventory
from backend.scripts.phase4_measure_latency import _percentile, _summary, _target
from backend.scripts.phase4_occ_parity import _decode_analyzer_json, _dimensions, compare
from backend.scripts.phase4_validate_system_inventory import validate_inventory


def test_legacy_inventory_contains_metadata_but_not_row_values(tmp_path: Path) -> None:
    database = tmp_path / "legacy.db"
    connection = sqlite3.connect(database)
    try:
        connection.execute("CREATE TABLE contacts (id INTEGER PRIMARY KEY, email TEXT NOT NULL)")
        connection.execute("INSERT INTO contacts (email) VALUES (?)", ("private@example.com",))
        connection.commit()
    finally:
        connection.close()

    report = inventory(database)
    rendered = json.dumps(report)
    assert report["quick_check"] == "ok"
    assert report["tables"][0]["row_count"] == 1
    assert "email" in rendered
    assert "private@example.com" not in rendered


def test_occ_json_decoder_accepts_one_noise_line() -> None:
    payload, noise_count = _decode_analyzer_json(
        "OpenCascade diagnostic\n"
        '{"success": true, "data": {"volume_mm3": 12.5}, "warnings": []}\n'
    )
    assert payload["success"] is True
    assert noise_count == 1


def test_occ_dimension_parser_handles_display_format() -> None:
    assert _dimensions("120.00 x 52.38 x 33.27") == [120.0, 52.38, 33.27]
    assert _dimensions(None) is None


def test_latency_percentiles_use_nearest_rank() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 100.0]
    assert _percentile(values, 0.50) == 3.0
    assert _percentile(values, 0.95) == 100.0
    assert _summary([])["p95"] is None


def test_latency_target_preserves_path_and_query() -> None:
    target = _target("https://example.com:8443/api/health?fresh=1")
    assert target.scheme == "https"
    assert target.hostname == "example.com"
    assert target.port == 8443
    assert target.path == "/api/health?fresh=1"


def test_runtime_storage_inventory_does_not_emit_filenames(tmp_path: Path) -> None:
    runtime_root = tmp_path / "uploads"
    runtime_root.mkdir()
    (runtime_root / "customer-secret-name.pdf").write_bytes(b"pdf-data")

    database = tmp_path / "portal.db"
    connection = sqlite3.connect(database)
    try:
        connection.execute(
            "CREATE TABLE portal_order_media ("
            "storage_backend TEXT, storage_key TEXT, file_size INTEGER, "
            "visible_to_customer INTEGER)"
        )
        connection.execute(
            "CREATE TABLE portal_pending_uploads (status TEXT)"
        )
        connection.execute(
            "INSERT INTO portal_order_media VALUES ('r2', 'secret/key.pdf', 8, 1)"
        )
        connection.execute("INSERT INTO portal_pending_uploads VALUES ('pending')")
        connection.commit()
    finally:
        connection.close()

    report = storage_inventory({"uploads": runtime_root}, database, content_hashes=True)
    rendered = json.dumps(report)
    assert report["totals"]["file_count"] == 1
    assert report["database_media_index"]["media"][0]["record_count"] == 1
    assert "customer-secret-name" not in rendered
    assert "secret/key.pdf" not in rendered


def test_occ_comparison_rejects_different_analyzer_source(tmp_path: Path) -> None:
    record = {
        "source_sha256": "a" * 64,
        "success": True,
        "source_format": "STEP",
        "volume_mm3": 100.0,
        "obb_dimensions_mm": [1.0, 2.0, 3.0],
        "aabb_dimensions_mm": [1.0, 2.0, 3.0],
        "duration_ms": 10.0,
        "thumbnail": {"exists": True},
    }
    baseline = tmp_path / "baseline.json"
    candidate = tmp_path / "candidate.json"
    output = tmp_path / "comparison.json"
    baseline.write_text(
        json.dumps({"label": "windows", "analyzer_sha256": "1" * 64, "files": [record]}),
        encoding="utf-8",
    )
    candidate.write_text(
        json.dumps({"label": "linux", "analyzer_sha256": "2" * 64, "files": [record]}),
        encoding="utf-8",
    )
    result = compare(
        SimpleNamespace(
            baseline=baseline,
            candidate=candidate,
            output=output,
            volume_relative_tolerance=0.001,
            dimension_absolute_tolerance_mm=0.05,
            max_duration_ratio=2.0,
            max_candidate_p95_ms=30000.0,
        )
    )
    report = json.loads(output.read_text(encoding="utf-8"))
    assert result == 1
    assert report["analyzer_sha256_match"] is False
    assert report["pass"] is False


def test_r2_inventory_reconciles_without_exposing_object_keys() -> None:
    indexed = [
        {"key": "portal/mfg/orders/1/private-a.png", "size_bytes": 10},
        {"key": "portal/mfg/orders/1/missing.pdf", "size_bytes": 20},
    ]
    provider = [
        {
            "key": "portal/mfg/orders/1/private-a.png",
            "size_bytes": 10,
            "etag": "etag-a",
            "last_modified_utc": "2026-07-11T00:00:00+00:00",
        },
        {
            "key": "portal/mfg/orders/1/orphan.mp4",
            "size_bytes": 30,
            "etag": "etag-b",
            "last_modified_utc": "2026-07-11T00:00:00+00:00",
        },
    ]

    report = reconcile_r2_inventory(indexed, provider)
    rendered = json.dumps(report)

    assert report["result"] == "fail"
    assert report["missing_from_provider_count"] == 1
    assert report["unindexed_in_provider_count"] == 1
    assert "private-a.png" not in rendered
    assert "missing.pdf" not in rendered
    assert "orphan.mp4" not in rendered


def test_system_inventory_validation_accepts_complete_resource_window() -> None:
    payload = {
        "resource_window": {
            "sample_count": 60,
            "summary": {
                "cpu_percent": {"p95": 42.5},
                "available_memory_bytes": {"p50": 4_000_000_000},
                "disk_queue_length": {"p95": 0.2},
            },
        }
    }

    assert validate_inventory(payload) == []


def test_system_inventory_validation_reports_each_missing_metric() -> None:
    payload = {
        "resource_window": {
            "sample_count": 1,
            "summary": {
                "cpu_percent": {"p95": None},
                "available_memory_bytes": {"p50": 4_000_000_000},
                "disk_queue_length": {"p95": None},
            },
        }
    }

    errors = validate_inventory(payload)

    assert "resource_window.summary.cpu_percent.p95 is unavailable or invalid" in errors
    assert "resource_window.summary.disk_queue_length.p95 is unavailable or invalid" in errors
