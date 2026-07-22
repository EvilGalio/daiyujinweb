from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

SCRIPTS_ROOT = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from materialize_reference_data import (
    REQUIRED_REFERENCE_PATHS,
    materialize_reference_data,
    verify_materialized_reference_data,
)


def _write_reference_package(root: Path) -> None:
    files: list[dict[str, object]] = []
    for relative in sorted(REQUIRED_REFERENCE_PATHS):
        payload = (relative + "\n").encode("utf-8")
        path = root.joinpath(*relative.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        files.append(
            {
                "path": relative,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        )
    (root / "manifest.json").write_text(
        json.dumps({"schema_version": 1, "files": files}),
        encoding="utf-8",
    )


def test_materializer_copies_only_verified_manifest_files(tmp_path: Path) -> None:
    reference_root = tmp_path / "private-reference-data"
    data_root = tmp_path / "runtime-data"
    reference_root.mkdir()
    _write_reference_package(reference_root)

    materialize_reference_data(reference_root, data_root)
    verify_materialized_reference_data(reference_root, data_root)

    observed = {
        path.relative_to(data_root).as_posix()
        for path in data_root.rglob("*")
        if path.is_file()
    }
    assert observed == REQUIRED_REFERENCE_PATHS


def test_materializer_rejects_tampered_source_and_existing_target(
    tmp_path: Path,
) -> None:
    reference_root = tmp_path / "private-reference-data"
    data_root = tmp_path / "runtime-data"
    reference_root.mkdir()
    _write_reference_package(reference_root)

    materialize_reference_data(reference_root, data_root)
    with pytest.raises(RuntimeError, match="Refusing to overwrite"):
        materialize_reference_data(reference_root, data_root)

    relative = sorted(REQUIRED_REFERENCE_PATHS)[0]
    reference_root.joinpath(*relative.split("/")).write_text(
        "tampered\n",
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="integrity check failed"):
        verify_materialized_reference_data(reference_root, data_root)
