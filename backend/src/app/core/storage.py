from __future__ import annotations

import asyncio
import base64
from functools import lru_cache
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.settings import settings


def storage_configured() -> bool:
    return bool(
        settings.AWS_ENDPOINT_URL_S3
        and settings.AWS_ACCESS_KEY_ID
        and settings.AWS_SECRET_ACCESS_KEY
        and settings.AWS_REGION
        and settings.DOCUMENTS_BUCKET
    )


def storage_provider() -> str:
    return "Neon Object Storage" if storage_configured() else "Persistent local storage"


def local_storage_root() -> Path:
    root = Path(settings.DOCUMENTS_LOCAL_DIR).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def local_storage_ready() -> bool:
    try:
        root = local_storage_root()
        probe = root / ".write-test"
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def encode_local_key(storage_key: str) -> str:
    return base64.urlsafe_b64encode(storage_key.encode("utf-8")).decode("ascii").rstrip("=")


def decode_local_key(token: str) -> str:
    padded = token + "=" * (-len(token) % 4)
    key = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    if not key.startswith("documents/local/"):
        raise ValueError("Invalid local document key.")
    return key


def _local_path(storage_key: str) -> Path:
    if not storage_key.startswith("documents/local/"):
        raise ValueError("Invalid local document key.")
    relative = storage_key.removeprefix("documents/local/")
    root = local_storage_root()
    path = (root / relative).resolve()
    if path != root and root not in path.parents:
        raise ValueError("Invalid local document path.")
    return path


def put_local_bytes(storage_key: str, content: bytes) -> None:
    path = _local_path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def get_local_bytes(storage_key: str) -> bytes:
    return _local_path(storage_key).read_bytes()


def local_object_exists(storage_key: str) -> bool:
    return _local_path(storage_key).is_file()


@lru_cache(maxsize=1)
def get_storage_client():
    if not storage_configured():
        raise RuntimeError("Neon Object Storage is not configured.")
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        endpoint_url=settings.AWS_ENDPOINT_URL_S3,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(
            connect_timeout=3, read_timeout=8, retries={"max_attempts": 2, "mode": "standard"}
        ),
    )


def presign_upload(storage_key: str, content_type: str, expires: int = 600) -> str:
    return get_storage_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.DOCUMENTS_BUCKET,
            "Key": storage_key,
            "ContentType": content_type,
        },
        ExpiresIn=expires,
    )


def presign_download(storage_key: str, expires: int = 900) -> str:
    return get_storage_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.DOCUMENTS_BUCKET, "Key": storage_key},
        ExpiresIn=expires,
    )


def delete_object(storage_key: str) -> None:
    if storage_key.startswith("documents/local/"):
        _local_path(storage_key).unlink(missing_ok=True)
        return
    get_storage_client().delete_object(Bucket=settings.DOCUMENTS_BUCKET, Key=storage_key)


def put_object_bytes(storage_key: str, content: bytes, content_type: str) -> None:
    if storage_key.startswith("documents/local/"):
        put_local_bytes(storage_key, content)
        return
    get_storage_client().put_object(
        Bucket=settings.DOCUMENTS_BUCKET, Key=storage_key, Body=content, ContentType=content_type
    )


def get_object_bytes(storage_key: str) -> bytes:
    if storage_key.startswith("documents/local/"):
        return get_local_bytes(storage_key)
    response = get_storage_client().get_object(Bucket=settings.DOCUMENTS_BUCKET, Key=storage_key)
    return response["Body"].read()


def object_exists(storage_key: str) -> bool:
    if storage_key.startswith("documents/local/"):
        return local_object_exists(storage_key)
    try:
        get_storage_client().head_object(Bucket=settings.DOCUMENTS_BUCKET, Key=storage_key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
            return False
        raise


async def put_object_bytes_async(storage_key: str, content: bytes, content_type: str) -> None:
    await asyncio.to_thread(put_object_bytes, storage_key, content, content_type)


async def get_object_bytes_async(storage_key: str) -> bytes:
    return await asyncio.to_thread(get_object_bytes, storage_key)


async def delete_object_async(storage_key: str) -> None:
    await asyncio.to_thread(delete_object, storage_key)


async def object_exists_async(storage_key: str) -> bool:
    return await asyncio.to_thread(object_exists, storage_key)
