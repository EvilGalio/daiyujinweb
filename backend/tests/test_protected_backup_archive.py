from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import py7zr
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scripts.protected_backup_archive as protected_archive  # noqa: E402
from scripts.protected_backup_archive import (  # noqa: E402
    PASSWORD_ENV,
    _commit_without_overwrite,
    _open_archive_readonly,
    _validate_open_archive,
    create_archive,
    extract_archive,
    verify_archive,
)


TEST_PASSWORD = "correct horse battery staple " * 2


def test_encrypted_archive_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "secret.txt").write_text("private backup material", encoding="utf-8")
    nested = source / "nested"
    nested.mkdir()
    (nested / "data.bin").write_bytes(b"\x00\x01\x02")

    archive_path = tmp_path / "backup.7z"
    create_archive(source, archive_path)
    verify_archive(archive_path)

    archive_bytes = archive_path.read_bytes()
    assert b"secret.txt" not in archive_bytes
    assert b"private backup material" not in archive_bytes

    output = tmp_path / "restored"
    extract_archive(archive_path, output)
    assert (output / "secret.txt").read_text(encoding="utf-8") == (
        "private backup material"
    )
    assert (output / "nested" / "data.bin").read_bytes() == b"\x00\x01\x02"


def test_password_must_come_from_current_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv(PASSWORD_ENV, raising=False)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "data.txt").write_text("data", encoding="utf-8")

    with pytest.raises(RuntimeError, match="current process"):
        create_archive(source, tmp_path / "backup.7z")


def test_create_refuses_to_overwrite_existing_archive(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "data.txt").write_text("data", encoding="utf-8")
    archive_path = tmp_path / "backup.7z"
    archive_path.write_bytes(b"existing")

    with pytest.raises(FileExistsError, match="overwrite"):
        create_archive(source, archive_path)
    assert archive_path.read_bytes() == b"existing"


def test_atomic_commit_does_not_overwrite_a_racing_destination(
    tmp_path: Path,
):
    temporary_path = tmp_path / "temporary.7z"
    archive_path = tmp_path / "backup.7z"
    temporary_path.write_bytes(b"new archive")
    archive_path.write_bytes(b"racing archive")

    with pytest.raises(FileExistsError):
        _commit_without_overwrite(temporary_path, archive_path)

    assert archive_path.read_bytes() == b"racing archive"
    assert temporary_path.read_bytes() == b"new archive"


@pytest.mark.skipif(os.name != "nt", reason="Windows sharing contract")
def test_open_archive_handle_denies_concurrent_writers(tmp_path: Path):
    archive_path = tmp_path / "archive.7z"
    archive_path.write_bytes(b"immutable")

    with _open_archive_readonly(archive_path):
        with pytest.raises(OSError):
            archive_path.open("r+b")


def test_extract_rejects_parent_traversal_member(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source_file = tmp_path / "source.txt"
    source_file.write_text("escape", encoding="utf-8")
    archive_path = tmp_path / "unsafe.7z"
    with py7zr.SevenZipFile(
        archive_path,
        mode="x",
        password=TEST_PASSWORD,
        header_encryption=True,
    ) as archive:
        archive.write(source_file, arcname="../escape.txt")

    output = tmp_path / "output"
    with pytest.raises(RuntimeError, match="unsafe member path"):
        extract_archive(archive_path, output)
    assert not (tmp_path / "escape.txt").exists()


@pytest.mark.parametrize(
    ("member", "message"),
    [
        (
            SimpleNamespace(
                filename="linked.txt",
                is_file=False,
                is_directory=False,
                is_symlink=True,
            ),
            "link member",
        ),
        (
            SimpleNamespace(
                filename="socket",
                is_file=False,
                is_directory=False,
                is_symlink=False,
            ),
            "non-regular or ambiguous",
        ),
        (
            SimpleNamespace(
                filename="ambiguous",
                is_file=True,
                is_directory=True,
                is_symlink=False,
            ),
            "non-regular or ambiguous",
        ),
    ],
)
def test_member_metadata_rejects_links_and_special_files(
    member: SimpleNamespace,
    message: str,
):
    archive = SimpleNamespace(
        needs_password=lambda: True,
        list=lambda: [member],
        archiveinfo=lambda: SimpleNamespace(uncompressed=1),
    )

    with pytest.raises(RuntimeError, match=message):
        _validate_open_archive(archive)


@pytest.mark.parametrize(
    "name",
    [
        "CONIN$/payload",
        "folder/COM¹.txt",
        "folder/name. ",
        "folder/name:stream",
        "folder/na?me",
    ],
)
def test_member_metadata_rejects_windows_unsafe_names(name: str):
    member = SimpleNamespace(
        filename=name,
        is_file=True,
        is_directory=False,
        is_symlink=False,
    )
    archive = SimpleNamespace(
        needs_password=lambda: True,
        list=lambda: [member],
        archiveinfo=lambda: SimpleNamespace(uncompressed=1),
    )

    with pytest.raises(RuntimeError, match="unsafe|device"):
        _validate_open_archive(archive)


def test_member_metadata_rejects_unicode_and_prefix_collisions():
    unicode_members = [
        SimpleNamespace(
            filename="café.txt",
            is_file=True,
            is_directory=False,
            is_symlink=False,
        ),
        SimpleNamespace(
            filename="cafe\u0301.txt",
            is_file=True,
            is_directory=False,
            is_symlink=False,
        ),
    ]
    unicode_archive = SimpleNamespace(
        needs_password=lambda: True,
        list=lambda: unicode_members,
        archiveinfo=lambda: SimpleNamespace(uncompressed=2),
    )
    with pytest.raises(RuntimeError, match="duplicate Windows member paths"):
        _validate_open_archive(unicode_archive)

    prefix_members = [
        SimpleNamespace(
            filename="parent",
            is_file=True,
            is_directory=False,
            is_symlink=False,
        ),
        SimpleNamespace(
            filename="parent/child.txt",
            is_file=True,
            is_directory=False,
            is_symlink=False,
        ),
    ]
    prefix_archive = SimpleNamespace(
        needs_password=lambda: True,
        list=lambda: prefix_members,
        archiveinfo=lambda: SimpleNamespace(uncompressed=2),
    )
    with pytest.raises(RuntimeError, match="prefix collision"):
        _validate_open_archive(prefix_archive)


def test_verify_and_extract_each_use_one_open_file_handle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "data.txt").write_text("private", encoding="utf-8")
    archive_path = tmp_path / "backup.7z"
    create_archive(source, archive_path)

    real_seven_zip = py7zr.SevenZipFile
    opened_objects: list[object] = []

    def tracking_seven_zip(file: object, *args: object, **kwargs: object):
        opened_objects.append(file)
        return real_seven_zip(file, *args, **kwargs)

    monkeypatch.setattr(
        protected_archive.py7zr,
        "SevenZipFile",
        tracking_seven_zip,
    )

    verify_archive(archive_path)
    assert len(opened_objects) == 1
    assert hasattr(opened_objects[0], "read")

    opened_objects.clear()
    extract_archive(archive_path, tmp_path / "output")
    assert len(opened_objects) == 1
    assert hasattr(opened_objects[0], "read")


def test_extract_verifies_expected_hash_on_the_same_open_handle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "data.txt").write_text("private", encoding="utf-8")
    archive_path = tmp_path / "backup.7z"
    create_archive(source, archive_path)
    expected = hashlib.sha256(archive_path.read_bytes()).hexdigest()

    extract_archive(
        archive_path,
        tmp_path / "valid-output",
        expected_sha256=expected,
    )
    assert (tmp_path / "valid-output" / "data.txt").read_text(
        encoding="utf-8"
    ) == "private"

    with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
        extract_archive(
            archive_path,
            tmp_path / "invalid-output",
            expected_sha256="0" * 64,
        )
    assert not any((tmp_path / "invalid-output").iterdir())


def test_create_rejects_links(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    target = tmp_path / "target.txt"
    target.write_text("private", encoding="utf-8")
    link = source / "linked.txt"
    try:
        os.symlink(target, link)
    except OSError:
        pytest.skip("Creating symlinks is not permitted on this Windows host")

    with pytest.raises(RuntimeError, match="link or junction"):
        create_archive(source, tmp_path / "backup.7z")


def test_create_rejects_a_linked_source_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "data.txt").write_text("private", encoding="utf-8")
    linked_source = tmp_path / "linked-payload"
    try:
        os.symlink(source, linked_source, target_is_directory=True)
    except OSError:
        pytest.skip("Creating directory symlinks is not permitted on this host")

    with pytest.raises(RuntimeError, match="cannot traverse a link or junction"):
        create_archive(linked_source, tmp_path / "backup.7z")


def test_extract_rejects_a_linked_output_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(PASSWORD_ENV, TEST_PASSWORD)
    source = tmp_path / "payload"
    source.mkdir()
    (source / "data.txt").write_text("private", encoding="utf-8")
    archive_path = tmp_path / "backup.7z"
    create_archive(source, archive_path)

    real_output = tmp_path / "real-output"
    real_output.mkdir()
    linked_output = tmp_path / "linked-output"
    try:
        os.symlink(real_output, linked_output, target_is_directory=True)
    except OSError:
        pytest.skip("Creating directory symlinks is not permitted on this host")

    with pytest.raises(RuntimeError, match="link or junction"):
        extract_archive(archive_path, linked_output)
