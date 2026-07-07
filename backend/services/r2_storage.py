"""R2 utility helpers for portal media upload/download."""
from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import func

from models import PortalOrderMedia


def _env(name: str) -> str:
    return str(os.environ.get(name, "") or "").strip()


def _bucket() -> str:
    return _env("R2_BUCKET")


def _endpoint() -> str:
    endpoint = _env("R2_ENDPOINT_URL") or _env("R2_ENDPOINT")
    if endpoint:
        return endpoint.rstrip("/")
    account = _env("R2_ACCOUNT_ID")
    if account:
        return f"https://{account}.r2.cloudflarestorage.com"
    return ""


def r2_enabled() -> bool:
    return bool(_bucket() and _endpoint() and _env("R2_ACCESS_KEY_ID") and _env("R2_SECRET_ACCESS_KEY"))


def r2_client():
    if not r2_enabled():
        return None

    try:
        import boto3
        from botocore.config import Config
    except Exception as exc:
        raise RuntimeError("R2 storage backend requires boto3") from exc

    return boto3.client(
        "s3",
        endpoint_url=_endpoint(),
        aws_access_key_id=_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("R2_SECRET_ACCESS_KEY"),
        region_name=_env("R2_REGION") or "auto",
        config=Config(signature_version="s3v4"),
    )


def make_object_key(site, order_id, upload_id, filename) -> str:
    site = str(site or "default").strip() or "default"
    order_id = int(order_id)
    upload_id = str(upload_id)
    name = Path(str(filename or "")).name or "file"
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return f"portal/{site}/orders/{order_id}/{upload_id}/{safe}"


def presign_put(key: str, content_type: str, expires_seconds: int = 600) -> str:
    client = r2_client()
    if client is None:
        raise RuntimeError("R2 backend is not configured")
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": _bucket(),
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=int(expires_seconds),
        HttpMethod="PUT",
    )


def presign_get(key: str, expires_seconds: int = 600, filename: str | None = None) -> str:
    client = r2_client()
    if client is None:
        raise RuntimeError("R2 backend is not configured")

    params = {
        "Bucket": _bucket(),
        "Key": key,
    }
    if filename:
        safe = quote(Path(str(filename)).name or "download")
        params["ResponseContentDisposition"] = f'inline; filename="{safe}"'
    return client.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=int(expires_seconds),
        HttpMethod="GET",
    )


def head_object(key: str) -> dict:
    client = r2_client()
    if client is None:
        raise RuntimeError("R2 backend is not configured")
    resp = client.head_object(Bucket=_bucket(), Key=key)
    return {
        "size": int(resp.get("ContentLength") or 0),
        "content_type": resp.get("ContentType"),
        "etag": resp.get("ETag"),
        "meta": resp.get("Metadata", {}),
    }


def delete_object(key: str) -> None:
    client = r2_client()
    if client is None:
        return None
    client.delete_object(Bucket=_bucket(), Key=key)
    return None


def current_r2_usage_bytes(session) -> int:
    total = session.query(func.coalesce(func.sum(PortalOrderMedia.file_size), 0)).filter(
        PortalOrderMedia.storage_backend == "r2",
        PortalOrderMedia.file_size.is_not(None),
    ).scalar()
    return int(total or 0)


def now() -> datetime:
    return datetime.utcnow()
