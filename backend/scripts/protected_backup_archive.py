"""Create, verify, and extract encrypted Precision Tools backup archives.

The encryption password is intentionally accepted only through the current
process environment. It must never be placed on a command line.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import stat
import tempfile
import unicodedata
import uuid
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator

import py7zr


PASSWORD_ENV = "ORDER_PORTAL_BACKUP_PASSWORD"
MINIMUM_PASSWORD_LENGTH = 32
MAXIMUM_MEMBER_COUNT = 1_000_000
MAXIMUM_UNCOMPRESSED_BYTES = 100 * 1024 * 1024 * 1024
WINDOWS_DEVICE_NAMES = {
    "AUX",
    "CLOCK$",
    "CON",
    "CONIN$",
    "CONOUT$",
    "NUL",
    "PRN",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
    *(f"COM{number}" for number in "¹²³"),
    *(f"LPT{number}" for number in "¹²³"),
}


def _password_from_process() -> str:
    password = os.environ.get(PASSWORD_ENV, "")
    if len(password) < MINIMUM_PASSWORD_LENGTH or "\r" in password or "\n" in password:
        raise RuntimeError(
            f"{PASSWORD_ENV} must be present in the current process and contain "
            f"at least {MINIMUM_PASSWORD_LENGTH} characters"
        )
    return password


def _is_link_or_junction(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(os.path, "isjunction", None)
    return bool(is_junction and is_junction(path))


def _absolute_without_resolving(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _reject_reparse_components(path: Path, label: str) -> None:
    candidate = _absolute_without_resolving(path)
    while True:
        if os.path.lexists(candidate) and _is_link_or_junction(candidate):
            raise RuntimeError(
                f"{label} cannot traverse a link or junction: {candidate}"
            )
        if candidate.parent == candidate:
            break
        candidate = candidate.parent


def _reject_source_links(source: Path) -> None:
    if _is_link_or_junction(source):
        raise RuntimeError(f"Backup source cannot be a link or junction: {source}")
    for root, directory_names, file_names in os.walk(source, followlinks=False):
        root_path = Path(root)
        for name in (*directory_names, *file_names):
            candidate = root_path / name
            if _is_link_or_junction(candidate):
                raise RuntimeError(
                    f"Backup source contains a link or junction: {candidate}"
                )


@contextmanager
def _open_archive_readonly(archive_path: Path) -> Iterator[BinaryIO]:
    """Open and lock one exact archive object for the complete operation."""

    archive_path = _absolute_without_resolving(archive_path)
    _reject_reparse_components(archive_path, "Backup archive")
    archive_path = archive_path.resolve(strict=True)
    if os.name == "nt":
        descriptor = _open_windows_archive_without_write_sharing(archive_path)
    else:
        descriptor = os.open(
            archive_path,
            os.O_RDONLY
            | getattr(os, "O_BINARY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except ImportError:
            pass
        except OSError:
            os.close(descriptor)
            raise RuntimeError("Backup archive could not be locked for reading")
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"Backup archive is not a regular file: {archive_path}")
        with os.fdopen(descriptor, "rb", closefd=False) as archive_file:
            yield archive_file
    finally:
        os.close(descriptor)


def _open_windows_archive_without_write_sharing(archive_path: Path) -> int:
    """Return an fd whose Windows handle denies writers, deletion, and reparses."""

    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    get_information = kernel32.GetFileInformationByHandleEx
    get_information.argtypes = (
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    )
    get_information.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL

    class FileAttributeTagInfo(ctypes.Structure):
        _fields_ = (
            ("FileAttributes", wintypes.DWORD),
            ("ReparseTag", wintypes.DWORD),
        )

    generic_read = 0x80000000
    file_share_read = 0x00000001
    open_existing = 3
    file_attribute_normal = 0x00000080
    file_flag_open_reparse_point = 0x00200000
    file_flag_sequential_scan = 0x08000000
    file_attribute_reparse_point = 0x00000400
    file_attribute_tag_info_class = 9
    invalid_handle_value = ctypes.c_void_p(-1).value

    handle = create_file(
        os.fspath(archive_path),
        generic_read,
        file_share_read,
        None,
        open_existing,
        file_attribute_normal
        | file_flag_open_reparse_point
        | file_flag_sequential_scan,
        None,
    )
    if handle == invalid_handle_value:
        raise OSError(ctypes.get_last_error(), ctypes.FormatError())
    descriptor: int | None = None
    try:
        tag_info = FileAttributeTagInfo()
        if not get_information(
            handle,
            file_attribute_tag_info_class,
            ctypes.byref(tag_info),
            ctypes.sizeof(tag_info),
        ):
            raise OSError(ctypes.get_last_error(), ctypes.FormatError())
        if tag_info.FileAttributes & file_attribute_reparse_point:
            raise RuntimeError(
                f"Backup archive cannot be a reparse point: {archive_path}"
            )
        descriptor = msvcrt.open_osfhandle(
            int(handle),
            os.O_RDONLY | getattr(os, "O_BINARY", 0),
        )
        return descriptor
    finally:
        if descriptor is None:
            close_handle(handle)


def _validate_member_name(name: str) -> str:
    normalized = name.replace("\\", "/")
    pure = PurePosixPath(normalized)
    if (
        not normalized
        or normalized.startswith("/")
        or normalized.startswith("//")
        or pure.is_absolute()
        or any(part in {"", ".", ".."} for part in pure.parts)
        or re.match(r"^[A-Za-z]:", normalized)
    ):
        raise RuntimeError(f"Archive contains an unsafe member path: {name!r}")
    for part in pure.parts:
        if (
            any(ord(character) < 32 for character in part)
            or any(character in '<>:"|?*' for character in part)
            or part.endswith((" ", "."))
        ):
            raise RuntimeError(f"Archive contains an unsafe member path: {name!r}")
        device_stem = part.rstrip(" .").split(".", 1)[0].upper()
        if device_stem in WINDOWS_DEVICE_NAMES:
            raise RuntimeError(f"Archive contains a Windows device path: {name!r}")
    return "/".join(
        unicodedata.normalize("NFC", part.rstrip(" .")).casefold()
        for part in pure.parts
    )


def _validate_open_archive(archive: py7zr.SevenZipFile) -> list[str]:
    """Validate metadata before any archive member is decompressed."""

    if not archive.needs_password():
        raise RuntimeError("Refusing an archive that is not password protected")
    members = archive.list()
    if not members:
        raise RuntimeError("Archive contains no members")
    if len(members) > MAXIMUM_MEMBER_COUNT:
        raise RuntimeError("Archive contains too many members")
    uncompressed_bytes = archive.archiveinfo().uncompressed
    if uncompressed_bytes > MAXIMUM_UNCOMPRESSED_BYTES:
        raise RuntimeError("Archive exceeds the protected restore size limit")

    names: list[str] = []
    canonical_names: set[str] = set()
    member_is_file: dict[str, bool] = {}
    for member in members:
        name = str(member.filename)
        is_file = bool(getattr(member, "is_file", False))
        is_directory = bool(getattr(member, "is_directory", False))
        is_symlink = bool(getattr(member, "is_symlink", False))
        if is_symlink:
            raise RuntimeError(f"Archive contains a link member: {name!r}")
        if is_file == is_directory:
            raise RuntimeError(
                f"Archive contains a non-regular or ambiguous member: {name!r}"
            )
        canonical_name = _validate_member_name(name)
        if canonical_name in canonical_names:
            raise RuntimeError(
                f"Archive contains duplicate Windows member paths: {name!r}"
            )
        canonical_names.add(canonical_name)
        member_is_file[canonical_name] = is_file
        names.append(name)
    for canonical_name in member_is_file:
        parts = canonical_name.split("/")
        for index in range(1, len(parts)):
            parent = "/".join(parts[:index])
            if member_is_file.get(parent, False):
                raise RuntimeError(
                    "Archive contains a file/directory prefix collision: "
                    f"{canonical_name!r}"
                )
    return names


def _commit_without_overwrite(temporary_path: Path, archive_path: Path) -> None:
    """Atomically publish an archive without ever replacing an existing path."""

    os.link(temporary_path, archive_path, follow_symlinks=False)
    temporary_path.unlink()


def create_archive(source: Path, archive_path: Path) -> None:
    source = _absolute_without_resolving(source)
    _reject_reparse_components(source, "Backup source")
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise RuntimeError(f"Backup source is not a directory: {source}")
    if archive_path.suffix.lower() != ".7z":
        raise RuntimeError("Protected backup archives must use the .7z extension")
    _reject_source_links(source)

    archive_path = _absolute_without_resolving(archive_path)
    _reject_reparse_components(archive_path.parent, "Backup archive destination")
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    _reject_reparse_components(archive_path.parent, "Backup archive destination")
    if os.path.lexists(archive_path):
        raise FileExistsError(
            f"Refusing to overwrite an existing archive: {archive_path}"
        )

    password = _password_from_process()
    temporary_path = archive_path.with_name(
        f".{archive_path.name}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with py7zr.SevenZipFile(
            temporary_path,
            mode="x",
            password=password,
            header_encryption=True,
        ) as archive:
            for child in sorted(
                source.iterdir(),
                key=lambda item: item.name.casefold(),
            ):
                if child.is_dir():
                    archive.writeall(child, arcname=child.name)
                else:
                    archive.write(child, arcname=child.name)
        _reject_reparse_components(source, "Backup source")
        _reject_source_links(source)
        verify_archive(temporary_path)
        _commit_without_overwrite(temporary_path, archive_path)
    finally:
        if os.path.lexists(temporary_path):
            temporary_path.unlink()


def verify_archive(archive_path: Path) -> None:
    password = _password_from_process()
    with _open_archive_readonly(archive_path) as archive_file:
        with py7zr.SevenZipFile(
            archive_file,
            mode="r",
            password=password,
            max_extract_size=MAXIMUM_UNCOMPRESSED_BYTES,
        ) as archive:
            _validate_open_archive(archive)
            bad_member = archive.testzip()
    if bad_member is not None:
        raise RuntimeError(f"Archive CRC verification failed for member: {bad_member}")


def _verify_open_file_hash(
    archive_file: BinaryIO,
    expected_sha256: str | None,
) -> None:
    if expected_sha256 is None:
        return
    expected = expected_sha256.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise RuntimeError("Expected archive SHA-256 is malformed")
    archive_file.seek(0)
    digest = hashlib.sha256()
    for block in iter(lambda: archive_file.read(1024 * 1024), b""):
        digest.update(block)
    actual = digest.hexdigest()
    if actual != expected:
        raise RuntimeError(
            f"Archive SHA-256 mismatch. Expected {expected}, got {actual}"
        )
    archive_file.seek(0)


def extract_archive(
    archive_path: Path,
    output_path: Path,
    expected_sha256: str | None = None,
) -> None:
    output_path = _absolute_without_resolving(output_path)
    _reject_reparse_components(output_path.parent, "Extraction target")
    if os.path.lexists(output_path) and (
        _is_link_or_junction(output_path) or not output_path.is_dir()
    ):
        raise RuntimeError(
            f"Extraction target cannot be a file, link, or junction: {output_path}"
        )
    if output_path.exists() and any(output_path.iterdir()):
        raise RuntimeError(f"Extraction target must be empty: {output_path}")
    output_path.mkdir(parents=True, exist_ok=True)
    _reject_reparse_components(output_path, "Extraction target")

    password = _password_from_process()
    with tempfile.TemporaryDirectory(
        prefix="protected-backup-extract-",
        dir=output_path.parent,
    ) as temporary_directory:
        staging_path = Path(temporary_directory)
        _reject_reparse_components(staging_path, "Extraction staging path")
        with _open_archive_readonly(archive_path) as archive_file:
            _verify_open_file_hash(archive_file, expected_sha256)
            with py7zr.SevenZipFile(
                archive_file,
                mode="r",
                password=password,
                max_extract_size=MAXIMUM_UNCOMPRESSED_BYTES,
            ) as archive:
                _validate_open_archive(archive)
                archive.extractall(path=staging_path)

        _reject_source_links(staging_path)
        for extracted in staging_path.rglob("*"):
            extracted.resolve(strict=True).relative_to(
                staging_path.resolve(strict=True)
            )
        _reject_reparse_components(output_path, "Extraction target")
        if not output_path.is_dir() or any(output_path.iterdir()):
            raise RuntimeError(
                f"Extraction target changed while the archive was read: {output_path}"
            )
        for child in staging_path.iterdir():
            destination = output_path / child.name
            _reject_reparse_components(destination, "Extraction target")
            if os.path.lexists(destination):
                raise RuntimeError(
                    f"Extraction destination unexpectedly exists: {destination}"
                )
            shutil.move(str(child), str(destination))
            _reject_reparse_components(destination, "Extraction target")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Operate on password-protected Precision Tools backups"
    )
    subparsers = parser.add_subparsers(dest="action", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("--source", required=True, type=Path)
    create.add_argument("--archive", required=True, type=Path)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--archive", required=True, type=Path)

    extract = subparsers.add_parser("extract")
    extract.add_argument("--archive", required=True, type=Path)
    extract.add_argument("--output", required=True, type=Path)
    extract.add_argument("--expected-sha256")
    return parser


def main() -> None:
    arguments = _parser().parse_args()
    if arguments.action == "create":
        create_archive(arguments.source, arguments.archive)
    elif arguments.action == "verify":
        verify_archive(arguments.archive)
    else:
        extract_archive(
            arguments.archive,
            arguments.output,
            arguments.expected_sha256,
        )


if __name__ == "__main__":
    main()
