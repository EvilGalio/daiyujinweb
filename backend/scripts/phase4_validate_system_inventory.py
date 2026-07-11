"""Validate the Phase 4 system inventory resource window."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


REQUIRED_METRICS = {
    "cpu_percent.p95": ("cpu_percent", "p95"),
    "available_memory_bytes.p50": ("available_memory_bytes", "p50"),
    "disk_queue_length.p95": ("disk_queue_length", "p95"),
}


def _finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value))


def validate_inventory(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    resource_window = payload.get("resource_window")
    if not isinstance(resource_window, dict):
        return ["resource_window is missing or invalid"]

    sample_count = resource_window.get("sample_count")
    if not isinstance(sample_count, int) or sample_count < 1:
        errors.append("resource_window.sample_count must be at least 1")

    summary = resource_window.get("summary")
    if not isinstance(summary, dict):
        errors.append("resource_window.summary is missing or invalid")
        return errors

    for label, (metric_name, statistic_name) in REQUIRED_METRICS.items():
        metric = summary.get(metric_name)
        value = metric.get(statistic_name) if isinstance(metric, dict) else None
        if not _finite_number(value):
            errors.append(f"resource_window.summary.{label} is unavailable or invalid")
    return errors


def load_and_validate(path: Path) -> tuple[dict[str, Any], list[str]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("System inventory root must be a JSON object")
    return payload, validate_inventory(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()

    payload, errors = load_and_validate(args.input.resolve())
    if errors:
        for error in errors:
            print(f"FAIL {error}")
        return 1

    resource_window = payload["resource_window"]
    summary = resource_window["summary"]
    print(
        "System inventory resource window: PASS "
        f"samples={resource_window['sample_count']} "
        f"cpu_p95={summary['cpu_percent']['p95']} "
        f"memory_p50={summary['available_memory_bytes']['p50']} "
        f"disk_queue_p95={summary['disk_queue_length']['p95']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
