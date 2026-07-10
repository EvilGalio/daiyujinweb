"""Capture and compare OCC geometry-analysis evidence without source filenames."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ANALYZER_SCRIPT = PROJECT_ROOT / "backend" / "scripts" / "analyze_cad_cli.py"
SUPPORTED_EXTENSIONS = {".stp", ".step", ".igs", ".iges"}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _dimensions(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, list):
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    try:
        return [float(item.strip()) for item in str(value).split("x")]
    except ValueError:
        return None


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def _python_version(python_executable: Path) -> str:
    completed = subprocess.run(
        [str(python_executable), "-c", "import platform; print(platform.python_version())"],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return completed.stdout.strip()


def _thumbnail_evidence(path_value: Any) -> dict[str, Any]:
    if not path_value:
        return {"exists": False, "size_bytes": None, "sha256": None}
    path = Path(str(path_value))
    if not path.is_file():
        return {"exists": False, "size_bytes": None, "sha256": None}
    return {
        "exists": True,
        "size_bytes": path.stat().st_size,
        "sha256": _sha256_file(path),
    }


def _decode_analyzer_json(stdout: str) -> tuple[dict[str, Any], int]:
    stripped = stdout.strip()
    try:
        return json.loads(stripped), 0
    except json.JSONDecodeError:
        lines = [line.strip() for line in stripped.splitlines() if line.strip()]
        for index in range(len(lines) - 1, -1, -1):
            line = lines[index]
            if not line.startswith("{"):
                continue
            try:
                return json.loads(line), index
            except json.JSONDecodeError:
                continue
    raise json.JSONDecodeError("No valid analyzer JSON object found", stdout, 0)


def _occ_runtime_metadata(python_executable: Path) -> dict[str, Any]:
    probe = (
        "import importlib.metadata, json\n"
        "payload = {}\n"
        "try:\n"
        "    payload['pythonocc_core_distribution'] = "
        "importlib.metadata.version('pythonocc-core')\n"
        "except Exception:\n"
        "    payload['pythonocc_core_distribution'] = None\n"
        "try:\n"
        "    import OCC\n"
        "    payload['occ_module_version'] = str(getattr(OCC, 'VERSION', '') or '')\n"
        "except Exception:\n"
        "    payload['occ_module_version'] = None\n"
        "print(json.dumps(payload, sort_keys=True))\n"
    )
    completed = subprocess.run(
        [str(python_executable), "-B", "-c", probe],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if completed.returncode != 0:
        return {
            "probe_ok": False,
            "return_code": completed.returncode,
            "stdout_sha256": hashlib.sha256(completed.stdout.encode("utf-8")).hexdigest(),
            "stderr_sha256": hashlib.sha256(completed.stderr.encode("utf-8")).hexdigest(),
        }
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        return {"probe_ok": False, "return_code": completed.returncode}
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError:
        return {
            "probe_ok": False,
            "return_code": completed.returncode,
            "stdout_sha256": hashlib.sha256(completed.stdout.encode("utf-8")).hexdigest(),
        }
    payload["probe_ok"] = True
    payload["probe_noise_line_count"] = max(0, len(lines) - 1)
    return payload


def _capture_one(
    source: Path,
    source_hash: str,
    occurrences: int,
    analyzer_python: Path,
    thumbnail_root: Path,
    site: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    thumbnail_dir = thumbnail_root / source_hash[:16]
    thumbnail_dir.mkdir(parents=True, exist_ok=True)
    command = [
        str(analyzer_python),
        "-B",
        str(ANALYZER_SCRIPT),
        str(source),
        str(thumbnail_dir),
        site,
    ]
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
    except subprocess.TimeoutExpired as exc:
        return {
            "source_sha256": source_hash,
            "extension": source.suffix.lower(),
            "size_bytes": source.stat().st_size,
            "occurrences": occurrences,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "return_code": None,
            "success": False,
            "error_type": "TimeoutExpired",
            "stdout_sha256": hashlib.sha256((exc.stdout or b"") if isinstance(exc.stdout, bytes) else str(exc.stdout or "").encode("utf-8")).hexdigest(),
            "stderr_sha256": hashlib.sha256((exc.stderr or b"") if isinstance(exc.stderr, bytes) else str(exc.stderr or "").encode("utf-8")).hexdigest(),
            "thumbnail": {"exists": False, "size_bytes": None, "sha256": None},
        }

    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    base: dict[str, Any] = {
        "source_sha256": source_hash,
        "extension": source.suffix.lower(),
        "size_bytes": source.stat().st_size,
        "occurrences": occurrences,
        "duration_ms": duration_ms,
        "return_code": completed.returncode,
        "stdout_sha256": hashlib.sha256(stdout.encode("utf-8")).hexdigest(),
        "stderr_sha256": hashlib.sha256(stderr.encode("utf-8")).hexdigest(),
    }
    try:
        payload, noise_line_count = _decode_analyzer_json(stdout)
    except json.JSONDecodeError:
        base.update(
            {
                "success": False,
                "error_type": "InvalidAnalyzerJson",
                "thumbnail": {"exists": False, "size_bytes": None, "sha256": None},
            }
        )
        return base

    data = payload.get("data") or {}
    error = payload.get("error")
    base.update(
        {
            "success": bool(payload.get("success")) and completed.returncode == 0,
            "source_format": data.get("source_format"),
            "volume_mm3": data.get("volume_mm3"),
            "obb_dimensions_mm": _dimensions(data.get("obb_dimensions_mm")),
            "aabb_dimensions_mm": _dimensions(data.get("aabb_dimensions_mm")),
            "warning_count": len(payload.get("warnings") or []),
            "stdout_noise_line_count": noise_line_count,
            "error_type": str(error).split(":", 1)[0] if error else None,
            "thumbnail": _thumbnail_evidence(data.get("thumbnail_path")),
        }
    )
    return base


def capture(args: argparse.Namespace) -> int:
    corpus = args.corpus.resolve()
    analyzer_python = args.analyzer_python.resolve()
    if not corpus.is_dir():
        raise FileNotFoundError(f"CAD corpus directory not found: {corpus}")
    if not analyzer_python.is_file():
        raise FileNotFoundError(f"Analyzer Python not found: {analyzer_python}")
    if not ANALYZER_SCRIPT.is_file():
        raise FileNotFoundError(f"Analyzer script not found: {ANALYZER_SCRIPT}")

    sources = sorted(
        path
        for path in corpus.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    if not sources:
        raise ValueError(f"No supported CAD files found in: {corpus}")

    grouped: dict[str, list[Path]] = {}
    for source in sources:
        grouped.setdefault(_sha256_file(source), []).append(source)

    thumbnail_root = args.output.resolve().parent / "thumbnails" / args.label
    records = [
        _capture_one(
            source=paths[0],
            source_hash=source_hash,
            occurrences=len(paths),
            analyzer_python=analyzer_python,
            thumbnail_root=thumbnail_root,
            site=args.site,
            timeout_seconds=args.timeout_seconds,
        )
        for source_hash, paths in sorted(grouped.items())
    ]
    durations = [float(item["duration_ms"]) for item in records]
    report = {
        "report_type": "occ_capture",
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "label": args.label,
        "platform": platform.platform(),
        "python_version": _python_version(analyzer_python),
        "occ_runtime": _occ_runtime_metadata(analyzer_python),
        "analyzer_sha256": _sha256_file(ANALYZER_SCRIPT),
        "site": args.site,
        "corpus_file_count": len(sources),
        "unique_content_count": len(records),
        "all_success": all(item.get("success") for item in records),
        "duration_ms": {
            "p50": _percentile(durations, 0.50),
            "p95": _percentile(durations, 0.95),
            "max": max(durations),
        },
        "files": records,
    }
    _write_json(args.output.resolve(), report)
    print(f"OCC capture written: {args.output.resolve()}")
    print(f"Files: {len(sources)}; unique: {len(records)}; all success: {report['all_success']}")
    return 0


def _relative_delta(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right), 1e-12)
    return abs(left - right) / denominator


def _compare_dimensions(
    baseline: list[float] | None,
    candidate: list[float] | None,
    tolerance: float,
) -> tuple[bool, list[float] | None]:
    if baseline is None or candidate is None or len(baseline) != len(candidate):
        return False, None
    deltas = [abs(left - right) for left, right in zip(baseline, candidate, strict=True)]
    return all(delta <= tolerance for delta in deltas), deltas


def compare(args: argparse.Namespace) -> int:
    baseline = _read_json(args.baseline.resolve())
    candidate = _read_json(args.candidate.resolve())
    baseline_files = {item["source_sha256"]: item for item in baseline.get("files", [])}
    candidate_files = {item["source_sha256"]: item for item in candidate.get("files", [])}
    all_hashes = sorted(set(baseline_files) | set(candidate_files))

    comparisons: list[dict[str, Any]] = []
    for source_hash in all_hashes:
        left = baseline_files.get(source_hash)
        right = candidate_files.get(source_hash)
        record: dict[str, Any] = {
            "source_sha256": source_hash,
            "present_in_baseline": left is not None,
            "present_in_candidate": right is not None,
            "checks": {},
        }
        if left is None or right is None:
            record["pass"] = False
            comparisons.append(record)
            continue

        checks = record["checks"]
        checks["success_match"] = left.get("success") == right.get("success")
        checks["candidate_success"] = bool(right.get("success"))
        checks["format_match"] = left.get("source_format") == right.get("source_format")

        volume_delta = None
        if left.get("volume_mm3") is not None and right.get("volume_mm3") is not None:
            volume_delta = _relative_delta(float(left["volume_mm3"]), float(right["volume_mm3"]))
        checks["volume_relative_delta"] = volume_delta
        checks["volume_pass"] = volume_delta is not None and volume_delta <= args.volume_relative_tolerance

        obb_pass, obb_deltas = _compare_dimensions(
            left.get("obb_dimensions_mm"),
            right.get("obb_dimensions_mm"),
            args.dimension_absolute_tolerance_mm,
        )
        aabb_pass, aabb_deltas = _compare_dimensions(
            left.get("aabb_dimensions_mm"),
            right.get("aabb_dimensions_mm"),
            args.dimension_absolute_tolerance_mm,
        )
        checks["obb_absolute_deltas_mm"] = obb_deltas
        checks["obb_pass"] = obb_pass
        checks["aabb_absolute_deltas_mm"] = aabb_deltas
        checks["aabb_pass"] = aabb_pass

        baseline_duration = max(float(left.get("duration_ms") or 0.0), 0.01)
        candidate_duration = float(right.get("duration_ms") or 0.0)
        duration_ratio = candidate_duration / baseline_duration
        checks["duration_ratio"] = duration_ratio
        checks["duration_pass"] = duration_ratio <= args.max_duration_ratio
        checks["thumbnail_exists_match"] = (
            (left.get("thumbnail") or {}).get("exists")
            == (right.get("thumbnail") or {}).get("exists")
        )
        record["pass"] = all(
            [
                checks["success_match"],
                checks["candidate_success"],
                checks["format_match"],
                checks["volume_pass"],
                checks["obb_pass"],
                checks["aabb_pass"],
                checks["duration_pass"],
            ]
        )
        comparisons.append(record)

    candidate_durations = [
        float(item.get("duration_ms") or 0.0) for item in candidate_files.values()
    ]
    candidate_p95 = _percentile(candidate_durations, 0.95)
    report = {
        "report_type": "occ_comparison",
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_label": baseline.get("label"),
        "candidate_label": candidate.get("label"),
        "analyzer_sha256_match": bool(baseline.get("analyzer_sha256"))
        and baseline.get("analyzer_sha256") == candidate.get("analyzer_sha256"),
        "baseline_occ_runtime": baseline.get("occ_runtime"),
        "candidate_occ_runtime": candidate.get("occ_runtime"),
        "thresholds": {
            "volume_relative_tolerance": args.volume_relative_tolerance,
            "dimension_absolute_tolerance_mm": args.dimension_absolute_tolerance_mm,
            "max_duration_ratio": args.max_duration_ratio,
            "max_candidate_p95_ms": args.max_candidate_p95_ms,
        },
        "corpus_match": set(baseline_files) == set(candidate_files),
        "candidate_p95_ms": candidate_p95,
        "candidate_p95_pass": candidate_p95 is not None and candidate_p95 <= args.max_candidate_p95_ms,
        "files": comparisons,
    }
    report["pass"] = (
        report["corpus_match"]
        and report["analyzer_sha256_match"]
        and report["candidate_p95_pass"]
        and all(item.get("pass") for item in comparisons)
    )
    _write_json(args.output.resolve(), report)
    print(f"OCC comparison written: {args.output.resolve()}")
    print(f"Overall pass: {report['pass']}")
    return 0 if report["pass"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture_parser = subparsers.add_parser("capture", help="Capture one OCC environment")
    capture_parser.add_argument("--label", required=True)
    capture_parser.add_argument("--corpus", type=Path, required=True)
    capture_parser.add_argument("--analyzer-python", type=Path, required=True)
    capture_parser.add_argument("--output", type=Path, required=True)
    capture_parser.add_argument("--site", default="default")
    capture_parser.add_argument("--timeout-seconds", type=int, default=180)
    capture_parser.set_defaults(func=capture)

    compare_parser = subparsers.add_parser("compare", help="Compare two captures")
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.add_argument("--output", type=Path, required=True)
    compare_parser.add_argument("--volume-relative-tolerance", type=float, default=0.001)
    compare_parser.add_argument("--dimension-absolute-tolerance-mm", type=float, default=0.05)
    compare_parser.add_argument("--max-duration-ratio", type=float, default=2.0)
    compare_parser.add_argument("--max-candidate-p95-ms", type=float, default=30000.0)
    compare_parser.set_defaults(func=compare)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
