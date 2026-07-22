from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any


REQUIRED_REFERENCE_PATHS = frozenset(
    {
        "material_standards/material_aliases.csv",
        "material_standards/material_equivalents.csv",
        "material_standards/sources.csv",
        "material_weight/material_density.csv",
        "material_weight/shapes.json",
        "quote_model_v2_2/coefficients_v2_2_A.json",
        "quote_model_v2_2/material_prices.csv",
        "quote_model_v2_2/material_public_options.json",
        "quote_model_v2_2/postprocess_aliases.csv",
        "quote_model_v2_2/postprocess_groups.csv",
        "quote_model_v2_2/process_aliases.csv",
    }
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_path(value: Any) -> str:
    text = str(value or "")
    candidate = Path(text)
    if (
        not text
        or candidate.is_absolute()
        or "\\" in text
        or candidate.parts != tuple(part for part in text.split("/") if part)
        or any(part in {".", ".."} for part in candidate.parts)
    ):
        raise RuntimeError(f"Invalid reference-data manifest path: {text!r}")
    return candidate.as_posix()


def load_manifest(reference_root: Path) -> list[dict[str, Any]]:
    manifest_path = reference_root / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError(f"Reference-data manifest not found: {manifest_path}")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or not isinstance(payload.get("files"), list):
        raise RuntimeError("Unsupported Precision Tools reference-data manifest")

    entries: list[dict[str, Any]] = []
    observed: set[str] = set()
    for raw in payload["files"]:
        if not isinstance(raw, dict):
            raise RuntimeError("Malformed reference-data manifest entry")
        relative = _safe_relative_path(raw.get("path"))
        if relative in observed:
            raise RuntimeError(f"Duplicate reference-data manifest path: {relative}")
        observed.add(relative)
        expected_hash = str(raw.get("sha256") or "").lower()
        expected_bytes = raw.get("bytes")
        if (
            len(expected_hash) != 64
            or any(character not in "0123456789abcdef" for character in expected_hash)
            or not isinstance(expected_bytes, int)
            or expected_bytes < 1
        ):
            raise RuntimeError(f"Malformed integrity metadata for {relative}")
        entries.append(
            {
                "path": relative,
                "sha256": expected_hash,
                "bytes": expected_bytes,
            }
        )
    if observed != REQUIRED_REFERENCE_PATHS:
        missing = sorted(REQUIRED_REFERENCE_PATHS - observed)
        unexpected = sorted(observed - REQUIRED_REFERENCE_PATHS)
        raise RuntimeError(
            "Reference-data manifest does not match the production contract: "
            f"missing={missing}, unexpected={unexpected}"
        )
    return entries


def _verified_source(reference_root: Path, entry: dict[str, Any]) -> Path:
    source = reference_root.joinpath(*entry["path"].split("/"))
    if not source.is_file():
        raise RuntimeError(f"Reference-data source file not found: {source}")
    if source.stat().st_size != entry["bytes"] or _sha256(source) != entry["sha256"]:
        raise RuntimeError(f"Reference-data integrity check failed: {entry['path']}")
    return source


def verify_materialized_reference_data(
    reference_root: Path,
    data_root: Path,
) -> None:
    reference_root = reference_root.resolve(strict=True)
    data_root = data_root.resolve(strict=True)
    for entry in load_manifest(reference_root):
        _verified_source(reference_root, entry)
        destination = data_root.joinpath(*entry["path"].split("/"))
        if (
            not destination.is_file()
            or destination.stat().st_size != entry["bytes"]
            or _sha256(destination) != entry["sha256"]
        ):
            raise RuntimeError(
                f"Materialized reference-data integrity check failed: {entry['path']}"
            )


def materialize_reference_data(reference_root: Path, data_root: Path) -> None:
    reference_root = reference_root.resolve(strict=True)
    data_root.mkdir(parents=True, exist_ok=True)
    data_root = data_root.resolve(strict=True)
    entries = load_manifest(reference_root)
    for entry in entries:
        source = _verified_source(reference_root, entry)
        destination = data_root.joinpath(*entry["path"].split("/"))
        if destination.exists():
            raise RuntimeError(
                f"Refusing to overwrite existing runtime reference data: {destination}"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(
            f".{destination.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with source.open("rb") as source_stream, temporary.open("xb") as target_stream:
                shutil.copyfileobj(source_stream, target_stream)
                target_stream.flush()
                os.fsync(target_stream.fileno())
            if (
                temporary.stat().st_size != entry["bytes"]
                or _sha256(temporary) != entry["sha256"]
            ):
                raise RuntimeError(
                    f"Copied reference-data integrity check failed: {entry['path']}"
                )
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    verify_materialized_reference_data(reference_root, data_root)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.verify_only:
        verify_materialized_reference_data(args.reference_root, args.data_root)
    else:
        materialize_reference_data(args.reference_root, args.data_root)
    print("Precision Tools reference data: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
