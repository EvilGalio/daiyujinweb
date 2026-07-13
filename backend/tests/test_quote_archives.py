from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services.archive_reader import extract_cad_members, list_cad_members


CAD_EXTENSIONS = {".stp", ".step", ".igs", ".iges"}


def _zip_bytes(entries: dict[str, bytes]) -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    buffer.seek(0)
    return buffer


def _list_members(path: Path, suffix: str):
    return list_cad_members(
        path,
        suffix,
        cad_extensions=CAD_EXTENSIONS,
        max_file_size=50 * 1024 * 1024,
        max_total_size=150 * 1024 * 1024,
        max_files=20,
    )


def test_zip_scans_nested_folders_and_extracts_only_cad(tmp_path: Path) -> None:
    archive_path = tmp_path / "parts.zip"
    archive_path.write_bytes(
        _zip_bytes(
            {
                "top.step": b"step-a",
                "folder/deeper/bracket.stp": b"step-b",
                "folder/readme.txt": b"ignore",
                "folder/nested.7z": b"ignore-archive",
            }
        ).getvalue()
    )

    members, warnings = _list_members(archive_path, ".zip")
    assert [member.name for member in members] == ["top.step", "folder/deeper/bracket.stp"]
    assert any("Unsupported file ignored" in warning for warning in warnings)
    assert any("Nested archive ignored" in warning for warning in warnings)

    output_dir = tmp_path / "uploads"
    extracted = extract_cad_members(archive_path, ".zip", members, output_dir)
    assert [item.path.read_bytes() for item in extracted] == [b"step-a", b"step-b"]


def test_zip_rejects_parent_directory_entries(tmp_path: Path) -> None:
    archive_path = tmp_path / "unsafe.zip"
    archive_path.write_bytes(_zip_bytes({"../outside.step": b"bad"}).getvalue())

    with pytest.raises(ValueError, match="Unsafe archive entry path"):
        _list_members(archive_path, ".zip")


def test_rar_adapter_scans_nested_folders(monkeypatch, tmp_path: Path) -> None:
    payloads = {
        "folder/deeper/a.step": b"step-a",
        "folder/b.iges": b"iges-b",
    }

    class FakeRarError(Exception):
        pass

    class FakeRarCannotExec(FakeRarError):
        pass

    class FakeInfo:
        def __init__(self, filename: str, data: bytes):
            self.filename = filename
            self.file_size = len(data)

        def isdir(self) -> bool:
            return False

    class FakeRarFile:
        def __init__(self, archive_path, errors="strict"):
            self.archive_path = archive_path

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def infolist(self):
            return [FakeInfo(name, data) for name, data in payloads.items()]

        def open(self, name: str):
            return io.BytesIO(payloads[name])

    fake_module = SimpleNamespace(
        Error=FakeRarError,
        RarCannotExec=FakeRarCannotExec,
        RarFile=FakeRarFile,
    )
    monkeypatch.setitem(sys.modules, "rarfile", fake_module)

    archive_path = tmp_path / "parts.rar"
    archive_path.write_bytes(b"fake-rar")
    members, warnings = _list_members(archive_path, ".rar")
    extracted = extract_cad_members(archive_path, ".rar", members, tmp_path / "rar-output")

    assert warnings == []
    assert [member.name for member in members] == list(payloads)
    assert [item.path.read_bytes() for item in extracted] == list(payloads.values())


def test_seven_zip_scans_nested_folders(tmp_path: Path) -> None:
    py7zr = pytest.importorskip("py7zr")
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    first = source_dir / "first.step"
    second = source_dir / "second.stp"
    first.write_bytes(b"step-a")
    second.write_bytes(b"step-b")

    archive_path = tmp_path / "parts.7z"
    with py7zr.SevenZipFile(archive_path, mode="w") as archive:
        archive.write(first, arcname="folder/first.step")
        archive.write(second, arcname="folder/deeper/second.stp")

    members, warnings = _list_members(archive_path, ".7z")
    extracted = extract_cad_members(archive_path, ".7z", members, tmp_path / "7z-output")

    assert warnings == []
    assert [member.name for member in members] == ["folder/first.step", "folder/deeper/second.stp"]
    assert [item.path.read_bytes() for item in extracted] == [b"step-a", b"step-b"]


def test_quote_upload_returns_all_nested_zip_parts(monkeypatch, tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'quote-test.db'}")

    import app as app_module

    upload_dir = tmp_path / "uploads"
    thumbnail_dir = tmp_path / "thumbnails"
    monkeypatch.setattr(app_module, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(app_module, "THUMBNAIL_DIR", thumbnail_dir)

    def fake_analysis(app, saved_path, display_name, source_filename=None, site="default"):
        return {
            "success": True,
            "source_filename": source_filename,
            "source_format": "STEP",
            "warnings": [],
            "data": {
                "name": Path(display_name).stem,
                "source_filename": source_filename,
                "source_format": "STEP",
                "volume_mm3": 1.0,
                "obb_dimensions_mm": "1 x 1 x 1",
            },
        }

    monkeypatch.setattr(app_module, "_run_cad_analysis", fake_analysis)
    response = app_module.app.test_client().post(
        "/api/public/quote/upload",
        data={
            "file": (
                _zip_bytes(
                    {
                        "folder/a.step": b"step-a",
                        "folder/deeper/b.stp": b"step-b",
                    }
                ),
                "batch.zip",
            )
        },
        content_type="multipart/form-data",
    )

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["archive"] is True
    assert [part["source_filename"] for part in payload["parts"]] == [
        "folder/a.step",
        "folder/deeper/b.stp",
    ]
