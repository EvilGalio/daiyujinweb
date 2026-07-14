from __future__ import annotations

import os
import shutil
import stat
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


SUPPORTED_ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z"}
MAX_ARCHIVE_ENTRIES = 2000
MAX_ARCHIVE_WARNINGS = 100


class ArchiveDependencyError(RuntimeError):
    pass


class ArchiveReadError(ValueError):
    pass


@dataclass(frozen=True)
class ArchiveMember:
    name: str
    size: int


@dataclass(frozen=True)
class ExtractedArchiveMember:
    member: ArchiveMember
    file_id: str
    path: Path


@dataclass(frozen=True)
class _ArchiveEntry:
    name: str
    size: int
    is_directory: bool
    is_symlink: bool = False


def _normalized_name(name: str) -> str:
    return str(name or "").replace("\\", "/")


def _is_unsafe_name(name: str) -> bool:
    normalized = _normalized_name(name)
    path = PurePosixPath(normalized)
    return (
        not normalized
        or normalized.startswith("/")
        or (path.parts and path.parts[0].endswith(":"))
        or any(part in {"", ".", ".."} for part in path.parts)
    )


def _metadata_flag(value, attribute: str) -> bool:
    flag = getattr(value, attribute, False)
    if callable(flag):
        try:
            return bool(flag())
        except (AttributeError, TypeError):
            return False
    return bool(flag)


def _zip_entries(archive_path: Path, max_entries: int) -> list[_ArchiveEntry]:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            if len(infos) > max_entries:
                raise ArchiveReadError(f"Archive contains more than {max_entries} entries.")
            return [
                _ArchiveEntry(
                    name=_normalized_name(info.filename),
                    size=int(info.file_size),
                    is_directory=bool(info.is_dir()),
                    is_symlink=stat.S_ISLNK((int(info.external_attr) >> 16) & 0xFFFF),
                )
                for info in infos
            ]
    except zipfile.BadZipFile as exc:
        raise ArchiveReadError("ZIP archive could not be read.") from exc


def _rar_entries(archive_path: Path, max_entries: int) -> list[_ArchiveEntry]:
    try:
        import rarfile
    except ImportError as exc:
        raise ArchiveDependencyError("RAR support is not installed on the quote server.") from exc

    try:
        with rarfile.RarFile(archive_path, errors="strict") as archive:
            infos = archive.infolist()
            if len(infos) > max_entries:
                raise ArchiveReadError(f"Archive contains more than {max_entries} entries.")
            return [
                _ArchiveEntry(
                    name=_normalized_name(info.filename),
                    size=int(info.file_size),
                    is_directory=bool(info.isdir()),
                    is_symlink=_metadata_flag(info, "is_symlink") or _metadata_flag(info, "is_link"),
                )
                for info in infos
            ]
    except rarfile.Error as exc:
        raise ArchiveReadError("RAR archive could not be read.") from exc


def _seven_zip_entries(
    archive_path: Path,
    max_extract_size: int,
    max_entries: int,
) -> list[_ArchiveEntry]:
    try:
        import py7zr
    except ImportError as exc:
        raise ArchiveDependencyError("7Z support is not installed on the quote server.") from exc

    try:
        with py7zr.SevenZipFile(archive_path, mode="r", max_extract_size=max_extract_size) as archive:
            infos = archive.list()
            if len(infos) > max_entries:
                raise ArchiveReadError(f"Archive contains more than {max_entries} entries.")
            return [
                _ArchiveEntry(
                    name=_normalized_name(info.filename),
                    size=int(info.uncompressed or 0),
                    is_directory=bool(info.is_directory),
                    is_symlink=(
                        _metadata_flag(info, "is_symlink")
                        or _metadata_flag(info, "is_link")
                        or _metadata_flag(info, "is_hardlink")
                    ),
                )
                for info in infos
            ]
    except ArchiveReadError:
        raise
    except Exception as exc:
        raise ArchiveReadError("7Z archive could not be read.") from exc


def list_cad_members(
    archive_path: str | Path,
    suffix: str,
    *,
    cad_extensions: set[str],
    max_file_size: int,
    max_total_size: int,
    max_files: int,
    max_entries: int = MAX_ARCHIVE_ENTRIES,
    max_warnings: int = MAX_ARCHIVE_WARNINGS,
) -> tuple[list[ArchiveMember], list[str]]:
    path = Path(archive_path)
    archive_suffix = suffix.lower()
    entry_limit = max(1, int(max_entries))
    warning_limit = max(1, int(max_warnings))
    if archive_suffix == ".zip":
        entries = _zip_entries(path, entry_limit)
    elif archive_suffix == ".rar":
        entries = _rar_entries(path, entry_limit)
    elif archive_suffix == ".7z":
        entries = _seven_zip_entries(path, max_total_size, entry_limit)
    else:
        raise ArchiveReadError("Unsupported archive format.")

    warnings: list[str] = []
    warning_count = 0
    members: list[ArchiveMember] = []
    seen_names: set[str] = set()
    total_size = 0

    def add_warning(message: str) -> None:
        nonlocal warning_count
        warning_count += 1
        if len(warnings) < warning_limit - 1:
            warnings.append(message)

    for entry in entries:
        name = _normalized_name(entry.name)
        if entry.is_symlink:
            raise ArchiveReadError(f"Archive link entries are not allowed: {name}")
        if entry.is_directory or name.startswith("__MACOSX/"):
            continue
        if _is_unsafe_name(name):
            raise ArchiveReadError(f"Unsafe archive entry path: {entry.name}")
        name_key = name.casefold()
        if name_key in seen_names:
            raise ArchiveReadError(f"Duplicate archive entry path: {name}")
        seen_names.add(name_key)

        member_suffix = PurePosixPath(name).suffix.lower()
        if member_suffix in SUPPORTED_ARCHIVE_EXTENSIONS:
            add_warning(f"Nested archive ignored: {name}")
            continue
        if member_suffix not in cad_extensions:
            add_warning(f"Unsupported file ignored: {name}")
            continue
        file_size = entry.size
        if file_size <= 0:
            add_warning(f"Empty CAD file ignored: {name}")
            continue
        if file_size > max_file_size:
            raise ArchiveReadError(
                f"CAD file exceeds the {max_file_size // (1024 * 1024)} MB per-file limit: {name}"
            )
        if len(members) >= max_files:
            raise ArchiveReadError(f"Archive contains more than {max_files} supported CAD files.")

        total_size += file_size
        if total_size > max_total_size:
            raise ArchiveReadError("Archive CAD contents exceed the 150 MB extracted-size limit.")
        members.append(ArchiveMember(name=name, size=file_size))

    omitted_warnings = warning_count - len(warnings)
    if omitted_warnings > 0:
        warnings.append(f"Additional archive notices omitted: {omitted_warnings}.")

    return members, warnings


def _output_jobs(members: list[ArchiveMember], destination_dir: Path) -> list[ExtractedArchiveMember]:
    jobs: list[ExtractedArchiveMember] = []
    for member in members:
        file_id = str(uuid.uuid4())
        safe_name = PurePosixPath(member.name).name.replace(":", "_")[:120]
        jobs.append(
            ExtractedArchiveMember(
                member=member,
                file_id=file_id,
                path=destination_dir / f"{file_id}_{safe_name}",
            )
        )
    return jobs


def _extract_zip(archive_path: Path, jobs: list[ExtractedArchiveMember]) -> None:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for job in jobs:
                with archive.open(job.member.name) as source, job.path.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
    except (zipfile.BadZipFile, KeyError, OSError) as exc:
        raise ArchiveReadError("ZIP archive could not be extracted.") from exc


def _extract_rar(archive_path: Path, jobs: list[ExtractedArchiveMember]) -> None:
    try:
        import rarfile
    except ImportError as exc:
        raise ArchiveDependencyError("RAR support is not installed on the quote server.") from exc

    _configure_rar_backend(rarfile)
    try:
        with rarfile.RarFile(archive_path, errors="strict") as archive:
            for job in jobs:
                with archive.open(job.member.name) as source, job.path.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
    except rarfile.RarCannotExec as exc:
        raise ArchiveDependencyError(
            "RAR extraction requires unrar, unar, 7z, or bsdtar on the quote server PATH."
        ) from exc
    except rarfile.Error as exc:
        raise ArchiveReadError("RAR archive could not be extracted.") from exc


def _configure_rar_backend(rarfile_module) -> None:
    configured_tool = os.environ.get("RAR_EXTRACTION_TOOL", "").strip()
    if not configured_tool and os.name == "nt":
        candidates = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "7-Zip" / "7z.exe",
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "WinRAR" / "UnRAR.exe",
        ]
        configured_tool = next((str(path) for path in candidates if path.is_file()), "")
    if not configured_tool:
        return

    tool_name = Path(configured_tool).name.lower()
    if tool_name.startswith("7z"):
        rarfile_module.SEVENZIP_TOOL = configured_tool
    elif tool_name.startswith("unar"):
        rarfile_module.UNAR_TOOL = configured_tool
    elif tool_name.startswith("bsdtar"):
        rarfile_module.BSDTAR_TOOL = configured_tool
    else:
        rarfile_module.UNRAR_TOOL = configured_tool
    rarfile_module.CURRENT_SETUP = None


def _seven_zip_targets(members: list[ArchiveMember]) -> list[str]:
    targets: set[str] = set()
    for member in members:
        parts = PurePosixPath(member.name).parts
        for index in range(1, len(parts)):
            targets.add("/".join(parts[:index]))
        targets.add(member.name)
    return sorted(targets)


def _extract_seven_zip(archive_path: Path, jobs: list[ExtractedArchiveMember], destination_dir: Path) -> None:
    try:
        import py7zr
    except ImportError as exc:
        raise ArchiveDependencyError("7Z support is not installed on the quote server.") from exc

    max_extract_size = max(sum(job.member.size for job in jobs), 1)
    try:
        with tempfile.TemporaryDirectory(prefix="quote-7z-", dir=destination_dir) as temp_name:
            temp_root = Path(temp_name).resolve()
            with py7zr.SevenZipFile(
                archive_path,
                mode="r",
                max_extract_size=max_extract_size,
            ) as archive:
                archive.extract(
                    path=temp_root,
                    targets=_seven_zip_targets([job.member for job in jobs]),
                    recursive=False,
                )

            for job in jobs:
                source = temp_root.joinpath(*PurePosixPath(job.member.name).parts)
                resolved = source.resolve(strict=True)
                if temp_root not in resolved.parents or source.is_symlink() or not source.is_file():
                    raise ArchiveReadError(f"Unsafe 7Z entry path: {job.member.name}")
                shutil.copyfile(source, job.path)
    except ArchiveReadError:
        raise
    except Exception as exc:
        raise ArchiveReadError("7Z archive could not be extracted.") from exc


def extract_cad_members(
    archive_path: str | Path,
    suffix: str,
    members: list[ArchiveMember],
    destination_dir: str | Path,
) -> list[ExtractedArchiveMember]:
    destination = Path(destination_dir)
    destination.mkdir(parents=True, exist_ok=True)
    jobs = _output_jobs(members, destination)

    try:
        archive_suffix = suffix.lower()
        if archive_suffix == ".zip":
            _extract_zip(Path(archive_path), jobs)
        elif archive_suffix == ".rar":
            _extract_rar(Path(archive_path), jobs)
        elif archive_suffix == ".7z":
            _extract_seven_zip(Path(archive_path), jobs, destination)
        else:
            raise ArchiveReadError("Unsupported archive format.")

        for job in jobs:
            if not job.path.is_file() or job.path.stat().st_size != job.member.size:
                raise ArchiveReadError(f"Extracted CAD size mismatch: {job.member.name}")
        return jobs
    except Exception:
        for job in jobs:
            job.path.unlink(missing_ok=True)
        raise
