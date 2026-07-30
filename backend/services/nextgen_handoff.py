"""Signed Quote references and the server-to-server NextGen handoff bridge."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import stat
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import update

from database import SessionLocal
from models import Inquiry


NEXTGEN_API_BASE_URL = "http://127.0.0.1:5400/api/v2"
NEXTGEN_COMPANY_CODE = "daiyujin"
NEXTGEN_CUSTOMER_PORTAL_URL = "https://portal.daiyujin.dpdns.org"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
LEGACY_UPLOAD_ROOT = BACKEND_ROOT / "uploads"
NEXTGEN_HANDOFF_STAGING_RELATIVE_PATH = Path("private") / "nextgen_handoff"
HANDOFF_SNAPSHOT_KEY = "_nextgen_handoff_snapshot_v1"
HANDOFF_SNAPSHOT_VERSION = 1
HANDOFF_SNAPSHOT_PURPOSE = b"nextgen-handoff-snapshot-v1\x00"
HANDOFF_SNAPSHOT_CAS_ATTEMPTS = 5
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_COPY_CHUNK_SIZE = 1024 * 1024
MAX_HANDOFF_CAD_SIZE_BYTES = 50 * 1024 * 1024
LEGACY_CAD_MIME_TYPES = {
    ".stp": "model/step",
    ".step": "model/step",
    ".igs": "model/iges",
    ".iges": "model/iges",
}
HANDOFF_PAYLOAD_KEYS = frozenset(
    {"source", "source_reference", "context", "contact_email"}
)
HANDOFF_CONTEXT_KEYS = frozenset(
    {
        "title",
        "part_name",
        "quantity_tiers",
        "material",
        "process",
        "tolerance",
        "finish",
        "model_version",
        "estimate_min",
        "estimate_max",
        "currency",
        "input",
        "selections",
        "warnings",
        "source_session_id",
        "file_references",
    }
)
HANDOFF_INPUT_KEYS = frozenset({"weight_kg", "max_dim_mm", "volume_mm3"})
HANDOFF_SELECTION_KEYS = frozenset(
    {
        "material",
        "material_category",
        "process",
        "postprocess_group",
        "quantity",
        "tolerance_grade",
    }
)
HANDOFF_FILE_REFERENCE_KEYS = frozenset(
    {
        "file_id",
        "original_filename",
        "mime_type",
        "staged_filename",
        "sha256",
        "size_bytes",
    }
)


class QuoteHandoffError(RuntimeError):
    """Raised when a Quote cannot be transferred safely."""


class QuoteReferenceError(QuoteHandoffError):
    """Raised when a public Quote reference is invalid or expired."""


class QuoteBridgeUnavailable(QuoteHandoffError):
    """Raised when the private Portal bridge is unavailable or misconfigured."""


def _secret(name: str) -> bytes:
    value = os.environ.get(name, "").strip()
    if len(value) < 32:
        raise QuoteBridgeUnavailable(f"{name} must contain at least 32 characters")
    return value.encode("utf-8")


def _nextgen_api_base() -> str:
    value = os.environ.get("NEXTGEN_API_BASE_URL", NEXTGEN_API_BASE_URL)
    if value != NEXTGEN_API_BASE_URL:
        raise QuoteBridgeUnavailable(
            "NEXTGEN_API_BASE_URL must use the reviewed NextGen loopback endpoint"
        )
    return value


def _nextgen_company_code() -> str:
    value = os.environ.get("NEXTGEN_COMPANY_CODE", NEXTGEN_COMPANY_CODE)
    if value != NEXTGEN_COMPANY_CODE:
        raise QuoteBridgeUnavailable(
            "NEXTGEN_COMPANY_CODE must identify the reviewed public-pilot company"
        )
    return value


def _expected_portal_origin() -> str:
    value = os.environ.get(
        "NEXTGEN_CUSTOMER_PORTAL_URL",
        NEXTGEN_CUSTOMER_PORTAL_URL,
    )
    if value != NEXTGEN_CUSTOMER_PORTAL_URL:
        raise QuoteBridgeUnavailable(
            "NEXTGEN_CUSTOMER_PORTAL_URL must use the reviewed public Portal"
        )
    return value


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        decoded = base64.urlsafe_b64decode((value + padding).encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc
    if _b64encode(decoded) != value:
        raise QuoteReferenceError("Quote reference is invalid")
    return decoded


def create_quote_reference(inquiry_id: int) -> str:
    payload = json.dumps(
        {"inquiry_id": int(inquiry_id), "issued_at": int(time.time())},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def create_file_receipt(file_id: str) -> str:
    try:
        canonical_file_id = str(uuid.UUID(str(file_id).strip().lower()))
    except ValueError as exc:
        raise QuoteReferenceError("File receipt input is invalid") from exc
    payload = json.dumps(
        {
            "file_id": canonical_file_id,
            "issued_at": int(time.time()),
            "purpose": "legacy-upload",
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def verify_file_receipt(receipt: str) -> str:
    try:
        payload_text, signature_text = str(receipt).strip().split(".", 1)
    except ValueError as exc:
        raise QuoteReferenceError("File receipt is invalid") from exc
    payload = _b64decode(payload_text)
    supplied = _b64decode(signature_text)
    expected = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(supplied, expected):
        raise QuoteReferenceError("File receipt is invalid")
    try:
        decoded = json.loads(payload.decode("utf-8"))
        file_id = str(uuid.UUID(str(decoded["file_id"]).strip().lower()))
        issued_at = int(decoded["issued_at"])
        purpose = str(decoded["purpose"])
    except (
        KeyError,
        TypeError,
        ValueError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as exc:
        raise QuoteReferenceError("File receipt is invalid") from exc
    now = int(time.time())
    ttl = int(
        os.environ.get(
            "QUOTE_FILE_RECEIPT_TTL_SECONDS",
            str(7 * 24 * 60 * 60),
        )
    )
    if (
        purpose != "legacy-upload"
        or ttl < 300
        or issued_at > now + 300
        or now - issued_at > ttl
    ):
        raise QuoteReferenceError("File receipt has expired")
    return file_id


def verify_quote_reference(reference: str) -> int:
    try:
        payload_text, signature_text = reference.strip().split(".", 1)
    except ValueError as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc
    payload = _b64decode(payload_text)
    supplied = _b64decode(signature_text)
    expected = hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        payload,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(supplied, expected):
        raise QuoteReferenceError("Quote reference is invalid")
    try:
        decoded = json.loads(payload.decode("utf-8"))
        inquiry_id = int(decoded["inquiry_id"])
        issued_at = int(decoded["issued_at"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise QuoteReferenceError("Quote reference is invalid") from exc
    ttl = int(os.environ.get("QUOTE_REFERENCE_TTL_SECONDS", str(7 * 24 * 60 * 60)))
    if ttl < 300 or int(time.time()) - issued_at > ttl:
        raise QuoteReferenceError("Quote reference has expired")
    if inquiry_id < 1:
        raise QuoteReferenceError("Quote reference is invalid")
    return inquiry_id


def _json_object(raw: str | None) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise QuoteBridgeUnavailable(
            "Stored Quote handoff context is invalid"
        ) from exc


def _finite_number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _positive_quantity(value: Any) -> int:
    try:
        quantity = int(value)
    except (TypeError, ValueError):
        return 1
    return quantity if quantity > 0 else 1


def _safe_text(value: Any, *, fallback: Any = "", limit: int = 500) -> str:
    def public_text(candidate: Any) -> str:
        if isinstance(candidate, str):
            return candidate.strip()
        if _finite_number(candidate) is not None:
            return str(candidate)
        return ""

    return (public_text(value) or public_text(fallback))[:limit]


def _safe_material_label(selections: dict[str, Any], inquiry: Inquiry) -> str:
    material = selections.get("material")
    if isinstance(material, dict):
        name = _safe_text(material.get("name"), limit=160)
        if name:
            return name
        material = material.get("id")
    return _safe_text(material, fallback=inquiry.material_name, limit=160)


def _lexical_absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _metadata_is_reparse(metadata: os.stat_result) -> bool:
    return stat.S_ISLNK(metadata.st_mode) or bool(
        getattr(metadata, "st_file_attributes", 0)
        & FILE_ATTRIBUTE_REPARSE_POINT
    )


def _assert_no_reparse_ancestors(path: Path, *, label: str) -> None:
    absolute = _lexical_absolute(path)
    for component in reversed((absolute, *absolute.parents)):
        try:
            metadata = os.stat(component, follow_symlinks=False)
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise QuoteBridgeUnavailable(
                f"{label} could not be inspected safely"
            ) from exc
        if _metadata_is_reparse(metadata):
            raise QuoteBridgeUnavailable(f"{label} must not traverse reparse points")


def _path_identity(metadata: os.stat_result) -> tuple[int, int]:
    return metadata.st_dev, metadata.st_ino


def _configured_handoff_staging_root() -> Path:
    configured_value = os.environ.get("NEXTGEN_HANDOFF_STAGING_ROOT", "")
    if not configured_value or configured_value != configured_value.strip():
        raise QuoteBridgeUnavailable(
            "NEXTGEN_HANDOFF_STAGING_ROOT must use the reviewed staging path"
        )
    configured = Path(configured_value)
    if not configured.is_absolute():
        raise QuoteBridgeUnavailable(
            "NEXTGEN_HANDOFF_STAGING_ROOT must use the reviewed staging path"
        )

    backend_root = _lexical_absolute(BACKEND_ROOT)
    expected = _lexical_absolute(
        backend_root / NEXTGEN_HANDOFF_STAGING_RELATIVE_PATH
    )
    actual = _lexical_absolute(configured)
    if os.path.normcase(os.fspath(actual)) != os.path.normcase(os.fspath(expected)):
        raise QuoteBridgeUnavailable(
            "NEXTGEN_HANDOFF_STAGING_ROOT must use the reviewed staging path"
        )
    try:
        backend_metadata = os.stat(backend_root, follow_symlinks=False)
    except OSError as exc:
        raise QuoteBridgeUnavailable(
            "The NextGen handoff staging parent is unavailable"
        ) from exc
    _assert_no_reparse_ancestors(
        backend_root,
        label="The NextGen handoff staging parent",
    )
    if not stat.S_ISDIR(backend_metadata.st_mode):
        raise QuoteBridgeUnavailable(
            "The NextGen handoff staging parent is unavailable"
        )

    for directory in (
        backend_root / "private",
        expected,
    ):
        try:
            directory.mkdir()
        except FileExistsError:
            pass
        except OSError as exc:
            raise QuoteBridgeUnavailable(
                "The NextGen handoff staging root could not be created"
            ) from exc
        _assert_no_reparse_ancestors(
            directory,
            label="The NextGen handoff staging root",
        )
        try:
            metadata = os.stat(directory, follow_symlinks=False)
        except OSError as exc:
            raise QuoteBridgeUnavailable(
                "The NextGen handoff staging root is unavailable"
            ) from exc
        if not stat.S_ISDIR(metadata.st_mode) or _metadata_is_reparse(metadata):
            raise QuoteBridgeUnavailable(
                "The NextGen handoff staging root is invalid"
            )
    return expected


def _existing_source_root(path: Path) -> Path | None:
    root = _lexical_absolute(path)
    try:
        metadata = os.stat(root, follow_symlinks=False)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise QuoteBridgeUnavailable(
            "The verified CAD source root is unavailable"
        ) from exc
    _assert_no_reparse_ancestors(root, label="The verified CAD source root")
    if not stat.S_ISDIR(metadata.st_mode) or _metadata_is_reparse(metadata):
        raise QuoteBridgeUnavailable("The verified CAD source root is invalid")
    return root


def _verified_regular_file(path: Path, *, root: Path) -> Path | None:
    candidate = _lexical_absolute(path)
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise QuoteBridgeUnavailable(
            "The verified CAD source escaped its approved root"
        ) from exc
    _assert_no_reparse_ancestors(candidate, label="The verified CAD source")
    try:
        metadata = os.stat(candidate, follow_symlinks=False)
        resolved_root = root.resolve(strict=True)
        resolved_candidate = candidate.resolve(strict=True)
        resolved_candidate.relative_to(resolved_root)
    except FileNotFoundError:
        return None
    except (OSError, RuntimeError, ValueError) as exc:
        raise QuoteBridgeUnavailable(
            "The verified CAD source could not be resolved safely"
        ) from exc
    if not stat.S_ISREG(metadata.st_mode) or _metadata_is_reparse(metadata):
        raise QuoteBridgeUnavailable(
            "The verified CAD source must be a regular file"
        )
    return candidate


def _find_verified_cad_source(file_id: str, suffix: str) -> Path | None:
    upload_root = _existing_source_root(LEGACY_UPLOAD_ROOT)
    quote_job_root = _existing_source_root(
        Path(
            os.environ.get(
                "QUOTE_JOB_STORAGE_ROOT",
                str(_lexical_absolute(LEGACY_UPLOAD_ROOT) / "quote-jobs"),
            )
        )
    )
    candidate_groups: list[tuple[Path, list[Path]]] = []
    try:
        if upload_root is not None:
            candidate_groups.append(
                (
                    upload_root,
                    [
                        upload_root / f"{file_id}{suffix}",
                        *sorted(upload_root.glob(f"{file_id}_*{suffix}")),
                    ],
                )
            )
        if quote_job_root is not None:
            candidate_groups.append(
                (
                    quote_job_root,
                    sorted(
                        quote_job_root.glob(
                            f"*/parts/{file_id}_*{suffix}"
                        )
                    ),
                )
            )
    except OSError as exc:
        raise QuoteBridgeUnavailable(
            "The verified CAD source could not be enumerated safely"
        ) from exc

    for root, candidates in candidate_groups:
        for candidate in candidates:
            verified = _verified_regular_file(candidate, root=root)
            if verified is not None:
                return verified
    return None


def _copy_source_to_staging_temp(
    source: Path,
    *,
    source_root: Path,
    staging_root: Path,
) -> tuple[Path, str, int]:
    verified = _verified_regular_file(source, root=source_root)
    if verified is None:
        raise QuoteBridgeUnavailable(
            "The verified CAD source disappeared before it could be staged"
        )
    temporary = staging_root / f".handoff-{uuid.uuid4().hex}.tmp"
    source_fd: int | None = None
    destination_fd: int | None = None
    completed = False
    try:
        source_before = os.stat(verified, follow_symlinks=False)
        if (
            source_before.st_size < 1
            or source_before.st_size > MAX_HANDOFF_CAD_SIZE_BYTES
        ):
            raise QuoteBridgeUnavailable(
                "The verified CAD source exceeds the handoff size limit"
            )
        source_flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
        source_flags |= getattr(os, "O_NOFOLLOW", 0)
        source_fd = os.open(verified, source_flags)
        opened_before = os.fstat(source_fd)
        if (
            not stat.S_ISREG(opened_before.st_mode)
            or _metadata_is_reparse(source_before)
            or _path_identity(source_before) != _path_identity(opened_before)
        ):
            raise QuoteBridgeUnavailable(
                "The verified CAD source changed before it could be staged"
            )

        destination_flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_BINARY", 0)
        )
        destination_fd = os.open(temporary, destination_flags, 0o600)
        digest = hashlib.sha256()
        size_bytes = 0
        with os.fdopen(source_fd, "rb") as source_stream:
            source_fd = None
            with os.fdopen(destination_fd, "wb") as destination_stream:
                destination_fd = None
                while True:
                    chunk = source_stream.read(FILE_COPY_CHUNK_SIZE)
                    if not chunk:
                        break
                    if size_bytes + len(chunk) > MAX_HANDOFF_CAD_SIZE_BYTES:
                        raise QuoteBridgeUnavailable(
                            "The verified CAD source exceeds the handoff size limit"
                        )
                    destination_stream.write(chunk)
                    digest.update(chunk)
                    size_bytes += len(chunk)
                destination_stream.flush()
                os.fsync(destination_stream.fileno())
            opened_after = os.fstat(source_stream.fileno())

        source_after = os.stat(verified, follow_symlinks=False)
        if (
            size_bytes < 1
            or _path_identity(opened_before) != _path_identity(opened_after)
            or _path_identity(opened_before) != _path_identity(source_after)
            or opened_before.st_size != opened_after.st_size
            or opened_before.st_mtime_ns != opened_after.st_mtime_ns
            or _metadata_is_reparse(source_after)
        ):
            raise QuoteBridgeUnavailable(
                "The verified CAD source changed while it was being staged"
            )
        _assert_no_reparse_ancestors(
            verified,
            label="The verified CAD source",
        )
        _assert_no_reparse_ancestors(
            staging_root,
            label="The NextGen handoff staging root",
        )
        completed = True
        return temporary, digest.hexdigest(), size_bytes
    except QuoteBridgeUnavailable:
        raise
    except OSError as exc:
        raise QuoteBridgeUnavailable(
            "The verified CAD source could not be staged"
        ) from exc
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if destination_fd is not None:
            os.close(destination_fd)
        if not completed:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
            except OSError as exc:
                raise QuoteBridgeUnavailable(
                    "The failed CAD staging candidate could not be removed"
                ) from exc


def _stable_staged_digest(path: Path, *, root: Path) -> tuple[str, int]:
    verified = _verified_regular_file(path, root=root)
    if verified is None:
        raise QuoteBridgeUnavailable(
            "The staged CAD file is unavailable"
        )
    file_fd: int | None = None
    try:
        before = os.stat(verified, follow_symlinks=False)
        if (
            before.st_size < 1
            or before.st_size > MAX_HANDOFF_CAD_SIZE_BYTES
        ):
            raise QuoteBridgeUnavailable(
                "The staged CAD file exceeds the handoff size limit"
            )
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        file_fd = os.open(verified, flags)
        opened_before = os.fstat(file_fd)
        if _path_identity(before) != _path_identity(opened_before):
            raise QuoteBridgeUnavailable(
                "The staged CAD file changed before verification"
            )
        digest = hashlib.sha256()
        size_bytes = 0
        with os.fdopen(file_fd, "rb") as stream:
            file_fd = None
            while True:
                chunk = stream.read(FILE_COPY_CHUNK_SIZE)
                if not chunk:
                    break
                if size_bytes + len(chunk) > MAX_HANDOFF_CAD_SIZE_BYTES:
                    raise QuoteBridgeUnavailable(
                        "The staged CAD file exceeds the handoff size limit"
                    )
                digest.update(chunk)
                size_bytes += len(chunk)
            opened_after = os.fstat(stream.fileno())
        after = os.stat(verified, follow_symlinks=False)
        if (
            _path_identity(opened_before) != _path_identity(opened_after)
            or _path_identity(opened_before) != _path_identity(after)
            or opened_before.st_size != opened_after.st_size
            or opened_before.st_mtime_ns != opened_after.st_mtime_ns
            or _metadata_is_reparse(after)
        ):
            raise QuoteBridgeUnavailable(
                "The staged CAD file changed during verification"
            )
        return digest.hexdigest(), size_bytes
    except QuoteBridgeUnavailable:
        raise
    except OSError as exc:
        raise QuoteBridgeUnavailable(
            "The staged CAD file could not be verified"
        ) from exc
    finally:
        if file_fd is not None:
            os.close(file_fd)


def _stage_verified_cad(
    source: Path,
    *,
    source_root: Path,
    file_id: str,
    original_filename: str,
    suffix: str,
) -> dict[str, Any]:
    staging_root = _configured_handoff_staging_root()
    temporary, sha256, size_bytes = _copy_source_to_staging_temp(
        source,
        source_root=source_root,
        staging_root=staging_root,
    )
    staged_filename = f"{file_id}_{sha256}{suffix}"
    staged_path = staging_root / staged_filename
    try:
        temporary_sha256, temporary_size = _stable_staged_digest(
            temporary,
            root=staging_root,
        )
        if temporary_sha256 != sha256 or temporary_size != size_bytes:
            raise QuoteBridgeUnavailable(
                "The CAD staging candidate does not match its verified source"
            )
        try:
            os.link(temporary, staged_path)
        except FileExistsError:
            pass
        except OSError as exc:
            raise QuoteBridgeUnavailable(
                "The staged CAD file could not be published atomically"
            ) from exc

        published_sha256, published_size = _stable_staged_digest(
            staged_path,
            root=staging_root,
        )
        if (
            published_sha256 != sha256
            or published_size != size_bytes
        ):
            raise QuoteBridgeUnavailable(
                "The staged CAD file does not match its verified source"
            )
        return {
            "file_id": file_id,
            "original_filename": original_filename,
            "mime_type": LEGACY_CAD_MIME_TYPES[suffix],
            "staged_filename": staged_filename,
            "sha256": sha256,
            "size_bytes": size_bytes,
        }
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise QuoteBridgeUnavailable(
                "The CAD staging candidate could not be removed"
            ) from exc


def _safe_file_reference(
    input_payload: dict[str, Any],
    inquiry: Inquiry,
) -> list[dict[str, Any]]:
    file_id = str(input_payload.get("file_id") or "").strip().lower()
    try:
        file_id = str(uuid.UUID(file_id))
    except ValueError:
        return []
    try:
        receipt_file_id = verify_file_receipt(
            str(input_payload.get("file_receipt") or "")
        )
    except QuoteReferenceError:
        return []
    if not hmac.compare_digest(receipt_file_id, file_id):
        return []
    filename = Path(str(input_payload.get("stp_filename") or inquiry.stp_filename or "")).name
    suffix = Path(filename).suffix.lower()
    if suffix not in LEGACY_CAD_MIME_TYPES:
        return []
    stored_path = _find_verified_cad_source(file_id, suffix)
    if stored_path is None:
        return []
    stored_name = stored_path.name
    prefix = f"{file_id}_"
    original_filename = (
        stored_name[len(prefix) :]
        if stored_name.lower().startswith(prefix)
        else filename
    )
    original_filename = Path(original_filename).name
    if (
        not original_filename
        or len(original_filename) > 255
        or Path(original_filename).suffix.lower() != suffix
    ):
        return []
    upload_root = _existing_source_root(LEGACY_UPLOAD_ROOT)
    quote_job_root = _existing_source_root(
        Path(
            os.environ.get(
                "QUOTE_JOB_STORAGE_ROOT",
                str(_lexical_absolute(LEGACY_UPLOAD_ROOT) / "quote-jobs"),
            )
        )
    )
    source_root = next(
        (
            root
            for root in (upload_root, quote_job_root)
            if root is not None
            and (
                stored_path == root
                or root in stored_path.parents
            )
        ),
        None,
    )
    if source_root is None:
        raise QuoteBridgeUnavailable(
            "The verified CAD source escaped its approved root"
        )
    return [
        _stage_verified_cad(
            stored_path,
            source_root=source_root,
            file_id=file_id,
            original_filename=original_filename,
            suffix=suffix,
        )
    ]


def _handoff_context(inquiry: Inquiry) -> dict[str, Any]:
    stored_input = _json_object(inquiry.input_params)
    stored_result = _json_object(inquiry.result)
    selections = stored_result.get("selections")
    if not isinstance(selections, dict):
        selections = stored_input.get("selections")
    selections = selections if isinstance(selections, dict) else {}
    total = stored_result.get("total_estimate")
    total = total if isinstance(total, dict) else {}
    estimate = _finite_number(total.get("amount"))
    quantity = _positive_quantity(inquiry.quantity or selections.get("quantity"))
    material = _safe_material_label(selections, inquiry)
    process = _safe_text(selections.get("process"), limit=120)
    tolerance = _safe_text(
        selections.get("tolerance_label")
        or selections.get("tolerance_grade"),
        fallback=inquiry.tolerance_grade,
        limit=120,
    )
    finish = _safe_text(
        selections.get("postprocess_public_label")
        or selections.get("postprocess_group"),
        limit=120,
    )
    currency = _safe_text(
        total.get("currency"),
        fallback=inquiry.currency or "USD",
        limit=3,
    ).upper()
    safe_selections = {
        "material": material,
        "material_category": _safe_text(
            selections.get("material_category"),
            limit=120,
        ),
        "process": process,
        "postprocess_group": finish,
        "quantity": quantity,
        "tolerance_grade": tolerance,
    }
    return {
        "title": _safe_text(
            inquiry.part_name,
            fallback="Manufacturing project",
            limit=240,
        ),
        "part_name": _safe_text(
            inquiry.part_name,
            fallback="Manufacturing part",
            limit=240,
        ),
        "quantity_tiers": [quantity],
        "material": material,
        "process": process,
        "tolerance": tolerance,
        "finish": finish,
        "model_version": _safe_text(
            stored_result.get("pricing_model_version"),
            fallback="legacy-online-quote",
            limit=120,
        ),
        "estimate_min": estimate,
        "estimate_max": estimate,
        "currency": currency,
        "input": {
            "weight_kg": _finite_number(inquiry.weight_kg),
            "max_dim_mm": _finite_number(inquiry.max_dim_mm),
            "volume_mm3": _finite_number(inquiry.volume_mm3),
        },
        "selections": safe_selections,
        "warnings": [],
        "source_session_id": f"legacy-inquiry-{inquiry.record_id}",
        "file_references": _safe_file_reference(stored_input, inquiry),
    }


def _build_handoff_payload(inquiry: Inquiry) -> dict[str, Any]:
    return {
        "source": "online_quote",
        "source_reference": f"legacy-quote-{inquiry.record_id}",
        "context": _handoff_context(inquiry),
        "contact_email": (
            _safe_text(inquiry.customer_email, limit=320)
            if inquiry.customer_email
            else None
        ),
    }


def _snapshot_signature(payload: dict[str, Any]) -> bytes:
    return hmac.new(
        _secret("QUOTE_HANDOFF_SIGNING_SECRET"),
        HANDOFF_SNAPSHOT_PURPOSE + _canonical_json_bytes(payload),
        hashlib.sha256,
    ).digest()


def _valid_snapshot_text(value: Any, *, limit: int) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _valid_snapshot_number(value: Any) -> bool:
    return value is None or _finite_number(value) is not None


def _valid_snapshot_file_reference(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != HANDOFF_FILE_REFERENCE_KEYS:
        return False
    file_id = value.get("file_id")
    original_filename = value.get("original_filename")
    mime_type = value.get("mime_type")
    staged_filename = value.get("staged_filename")
    sha256 = value.get("sha256")
    size_bytes = value.get("size_bytes")
    if not all(
        isinstance(item, str)
        for item in (
            file_id,
            original_filename,
            mime_type,
            staged_filename,
            sha256,
        )
    ):
        return False
    try:
        if str(uuid.UUID(file_id)) != file_id:
            return False
    except ValueError:
        return False
    if (
        not original_filename
        or len(original_filename) > 255
        or Path(original_filename).name != original_filename
    ):
        return False
    suffix = Path(original_filename).suffix.lower()
    if (
        suffix not in LEGACY_CAD_MIME_TYPES
        or mime_type != LEGACY_CAD_MIME_TYPES[suffix]
        or len(sha256) != 64
        or sha256.lower() != sha256
        or any(character not in "0123456789abcdef" for character in sha256)
        or isinstance(size_bytes, bool)
        or not isinstance(size_bytes, int)
        or size_bytes < 1
        or size_bytes > MAX_HANDOFF_CAD_SIZE_BYTES
    ):
        return False
    expected_staged_filename = f"{file_id}_{sha256}{suffix}"
    return (
        staged_filename == expected_staged_filename
        and Path(staged_filename).name == staged_filename
    )


def _validate_snapshot_payload(
    payload: Any,
    *,
    inquiry_id: int,
) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != HANDOFF_PAYLOAD_KEYS:
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")
    context = payload.get("context")
    if (
        payload.get("source") != "online_quote"
        or payload.get("source_reference") != f"legacy-quote-{inquiry_id}"
        or not isinstance(context, dict)
        or set(context) != HANDOFF_CONTEXT_KEYS
    ):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")
    if {
        "brand",
        "brand_code",
        "company",
        "company_code",
        "return_url",
        "site",
        "theme",
    } & payload.keys():
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")

    selections = context.get("selections")
    numeric_input = context.get("input")
    quantity_tiers = context.get("quantity_tiers")
    file_references = context.get("file_references")
    if (
        not isinstance(selections, dict)
        or set(selections) != HANDOFF_SELECTION_KEYS
        or not isinstance(numeric_input, dict)
        or set(numeric_input) != HANDOFF_INPUT_KEYS
        or not isinstance(quantity_tiers, list)
        or len(quantity_tiers) != 1
        or not isinstance(file_references, list)
        or len(file_references) > 1
    ):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")

    quantity = quantity_tiers[0]
    if (
        isinstance(quantity, bool)
        or not isinstance(quantity, int)
        or quantity < 1
        or selections.get("quantity") != quantity
        or context.get("warnings") != []
        or context.get("source_session_id") != f"legacy-inquiry-{inquiry_id}"
        or context.get("material") != selections.get("material")
        or context.get("process") != selections.get("process")
        or context.get("tolerance") != selections.get("tolerance_grade")
        or context.get("finish") != selections.get("postprocess_group")
    ):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")

    text_fields = (
        (context.get("title"), 240),
        (context.get("part_name"), 240),
        (context.get("material"), 160),
        (context.get("process"), 120),
        (context.get("tolerance"), 120),
        (context.get("finish"), 120),
        (context.get("model_version"), 120),
        (context.get("currency"), 3),
        (selections.get("material_category"), 120),
    )
    if (
        any(
            not _valid_snapshot_text(value, limit=limit)
            for value, limit in text_fields
        )
        or not all(_valid_snapshot_number(value) for value in numeric_input.values())
        or not _valid_snapshot_number(context.get("estimate_min"))
        or not _valid_snapshot_number(context.get("estimate_max"))
        or context.get("estimate_min") != context.get("estimate_max")
        or not all(
            _valid_snapshot_file_reference(reference)
            for reference in file_references
        )
    ):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")

    contact_email = payload.get("contact_email")
    if contact_email is not None and not _valid_snapshot_text(
        contact_email,
        limit=320,
    ):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")
    return payload


def _load_handoff_snapshot(
    stored_input: dict[str, Any],
    *,
    inquiry_id: int,
) -> dict[str, Any] | None:
    snapshot = stored_input.get(HANDOFF_SNAPSHOT_KEY)
    if snapshot is None:
        return None
    if (
        not isinstance(snapshot, dict)
        or set(snapshot) != {"version", "payload", "signature"}
        or snapshot.get("version") != HANDOFF_SNAPSHOT_VERSION
        or not isinstance(snapshot.get("signature"), str)
    ):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")
    payload = _validate_snapshot_payload(
        snapshot.get("payload"),
        inquiry_id=inquiry_id,
    )
    try:
        supplied = _b64decode(snapshot["signature"])
    except QuoteReferenceError as exc:
        raise QuoteBridgeUnavailable(
            "Stored Quote handoff snapshot is invalid"
        ) from exc
    if not hmac.compare_digest(supplied, _snapshot_signature(payload)):
        raise QuoteBridgeUnavailable("Stored Quote handoff snapshot is invalid")
    return payload


def _compare_and_set_handoff_input(
    session: Any,
    *,
    inquiry_id: int,
    expected_input: str,
    replacement_input: str,
) -> bool:
    statement = (
        update(Inquiry)
        .where(
            Inquiry.record_id == inquiry_id,
            Inquiry.input_params == expected_input,
        )
        .values(input_params=replacement_input)
        .execution_options(synchronize_session=False)
    )
    result = session.execute(statement)
    if result.rowcount not in {0, 1}:
        raise QuoteBridgeUnavailable(
            "Quote handoff snapshot compare-and-set returned an invalid result"
        )
    return result.rowcount == 1


def _freeze_handoff_payload(
    session: Any,
    inquiry: Inquiry,
) -> dict[str, Any]:
    inquiry_id = inquiry.record_id
    current = inquiry
    for _attempt in range(HANDOFF_SNAPSHOT_CAS_ATTEMPTS):
        expected_input = current.input_params
        stored_input = _json_object(expected_input)
        existing = _load_handoff_snapshot(
            stored_input,
            inquiry_id=inquiry_id,
        )
        if existing is not None:
            return existing

        payload = _validate_snapshot_payload(
            _build_handoff_payload(current),
            inquiry_id=inquiry_id,
        )
        stored_input[HANDOFF_SNAPSHOT_KEY] = {
            "version": HANDOFF_SNAPSHOT_VERSION,
            "payload": payload,
            "signature": _b64encode(_snapshot_signature(payload)),
        }
        replacement_input = json.dumps(
            stored_input,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        try:
            won = _compare_and_set_handoff_input(
                session,
                inquiry_id=inquiry_id,
                expected_input=expected_input,
                replacement_input=replacement_input,
            )
            if won:
                session.commit()
                return payload
            session.rollback()
        except QuoteBridgeUnavailable:
            session.rollback()
            raise
        except Exception as exc:
            session.rollback()
            raise QuoteBridgeUnavailable(
                "Quote handoff snapshot could not be persisted"
            ) from exc

        session.expire_all()
        current = session.get(Inquiry, inquiry_id)
        if current is None:
            raise QuoteHandoffError("Quote reference was not found")

    raise QuoteBridgeUnavailable(
        "Quote handoff snapshot could not be frozen after concurrent updates"
    )


def create_nextgen_handoff(
    *,
    quote_reference: str,
) -> dict[str, Any]:
    inquiry_id = verify_quote_reference(quote_reference)
    api_base = _nextgen_api_base()
    _nextgen_company_code()
    expected_portal_origin = _expected_portal_origin()
    bridge_secret = _secret("NEXTGEN_LEGACY_HANDOFF_SECRET").decode("utf-8")
    session = SessionLocal()
    try:
        inquiry = session.get(Inquiry, inquiry_id)
        if inquiry is None:
            raise QuoteHandoffError("Quote reference was not found")
        payload = _freeze_handoff_payload(session, inquiry)
    finally:
        session.close()
        SessionLocal.remove()

    body = _canonical_json_bytes(payload)
    outbound = urllib.request.Request(
        f"{api_base}/public/handoffs",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Idempotency-Key": f"legacy-quote-{inquiry_id}",
            "X-Legacy-Handoff-Secret": bridge_secret,
        },
    )
    try:
        with urllib.request.urlopen(outbound, timeout=12) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise QuoteBridgeUnavailable(
            f"Customer Portal rejected the handoff ({exc.code})"
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise QuoteBridgeUnavailable("Customer Portal is temporarily unavailable") from exc
    except json.JSONDecodeError as exc:
        raise QuoteBridgeUnavailable("Customer Portal returned an invalid response") from exc
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        result = result["data"]
    if not isinstance(result, dict) or not result.get("sign_up_url"):
        raise QuoteBridgeUnavailable("Customer Portal did not return a sign-up link")
    destination = urlsplit(str(result["sign_up_url"]))
    destination_origin = f"{destination.scheme}://{destination.netloc}"
    if destination_origin != expected_portal_origin:
        raise QuoteBridgeUnavailable("Customer Portal returned an unexpected origin")
    return result
