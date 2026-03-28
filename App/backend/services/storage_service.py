"""Asset storage service with pluggable local and S3 backends."""

from __future__ import annotations

import base64
import io
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Any, Iterator

from PIL import Image, ImageOps

# Optional: registers AVIF support with Pillow when installed
try:
    import pillow_avif  # type: ignore  # noqa: F401
except ImportError:  # pragma: no cover
    pillow_avif = None  # type: ignore


def _int_env(name: str, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError:
        value = default

    if min_value is not None:
        value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)

    return value


AVIF_QUALITY = _int_env("ASSET_AVIF_QUALITY", 80, min_value=0, max_value=100)
AVIF_SPEED = _int_env("ASSET_AVIF_SPEED", 6, min_value=0, max_value=10)  # 0 (slow/best) - 10 (fast/worst)
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_CACHE_CONTROL = "public, max-age=31536000, immutable"
_STREAM_CHUNK_SIZE = 1024 * 1024
_VALID_STORAGE_BACKENDS = {"local", "s3"}


class AssetFileNotFoundError(FileNotFoundError):
    """Raised when a stored asset does not exist."""


class AssetStorageUnavailableError(RuntimeError):
    """Raised when asset storage cannot serve an asset."""


@dataclass
class AssetStream:
    """Proxy-friendly stream payload and response metadata."""

    body: Any
    content_type: str
    content_length: int | None
    etag: str | None
    last_modified: str | None
    cache_control: str


def _default_local_storage_path() -> Path:
    return Path(__file__).resolve().parents[1] / "storage" / "assets"


class StorageBackendBase(ABC):
    """Shared asset transformation helpers plus backend-specific I/O hooks."""

    name: str

    def _require_env(self, name: str) -> str:
        value = str(os.getenv(name) or "").strip()
        if not value:
            raise RuntimeError(f"{name} must be set for asset storage")
        return value

    def _normalize_storage_key(self, storage_key: str) -> str:
        normalized = str(storage_key or "").strip().replace("\\", "/").lstrip("/")
        if not normalized:
            raise ValueError("storage key is required")
        return normalized

    def _generate_filename(self, original_name: str, project_id: uuid.UUID) -> str:
        ext = Path(original_name).suffix.lower() or ".png"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        return f"{project_id}_{timestamp}_{unique_id}{ext}"

    def _get_mime_type(self, filename: str) -> str:
        ext = Path(filename).suffix.lower()
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".avif": "image/avif",
            ".pdf": "application/pdf",
        }
        return mime_types.get(ext, "image/png")

    def _ensure_avif_supported(self) -> None:
        if Image.registered_extensions().get(".avif") != "AVIF":
            raise RuntimeError(
                "AVIF support is not available. Install 'pillow-avif-plugin' and ensure it is importable."
            )

    def _encode_avif(self, img: Image.Image) -> bytes:
        self._ensure_avif_supported()

        out = io.BytesIO()
        img_for_save = img
        if img_for_save.mode == "P":
            img_for_save = img_for_save.convert("RGBA")
        elif img_for_save.mode == "LA":
            img_for_save = img_for_save.convert("RGBA")
        elif img_for_save.mode not in ("RGB", "RGBA"):
            img_for_save = img_for_save.convert("RGBA" if "A" in img_for_save.getbands() else "RGB")

        img_for_save.save(
            out,
            format="AVIF",
            quality=AVIF_QUALITY,
            speed=AVIF_SPEED,
        )
        return out.getvalue()

    def _encode_png(self, img: Image.Image) -> bytes:
        out = io.BytesIO()
        img_for_save = img
        if img_for_save.mode == "P":
            img_for_save = img_for_save.convert("RGBA")

        img_for_save.save(out, format="PNG", optimize=True)
        return out.getvalue()

    def _save_image_bytes(
        self,
        *,
        image_bytes: bytes,
        original_name: str,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
    ) -> tuple[str, str, int, int, int]:
        del original_name, project_id
        filename = f"{asset_id}.avif"
        storage_key = self._normalize_storage_key(f"originals/{filename}")

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            encoded_bytes = self._encode_avif(img)

        mime_type = self._get_mime_type(filename)
        self._write_asset_bytes(storage_key=storage_key, body=encoded_bytes, mime_type=mime_type)
        return storage_key, mime_type, width, height, len(encoded_bytes)

    @abstractmethod
    def _write_asset_bytes(self, *, storage_key: str, body: bytes, mime_type: str) -> None:
        raise NotImplementedError

    def build_public_asset_path(self, storage_key: str) -> str:
        return f"/storage/assets/{self._normalize_storage_key(storage_key)}"

    def to_png_bytes(self, image_bytes: bytes) -> bytes:
        if image_bytes.startswith(_PNG_MAGIC):
            return image_bytes

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            return self._encode_png(img)

    def save_uploaded_file(
        self,
        file_content: bytes,
        original_filename: str,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
    ) -> tuple[str, str, int, int, int]:
        return self._save_image_bytes(
            image_bytes=file_content,
            original_name=original_filename,
            project_id=project_id,
            asset_id=asset_id,
        )

    def save_raw_file(
        self,
        file_content: bytes,
        original_filename: str,
        project_id: uuid.UUID,
        *,
        storage_prefix: str,
        mime_type: str | None = None,
    ) -> tuple[str, str, int]:
        filename = self._generate_filename(original_filename, project_id)
        normalized_prefix = self._normalize_storage_key(storage_prefix).rstrip("/")
        storage_key = self._normalize_storage_key(f"{normalized_prefix}/{project_id}/{filename}")
        resolved_mime_type = str(mime_type or self._get_mime_type(original_filename)).strip() or "application/octet-stream"
        self._write_asset_bytes(storage_key=storage_key, body=file_content, mime_type=resolved_mime_type)
        return storage_key, resolved_mime_type, len(file_content)

    def save_generated_image(
        self,
        base64_data: str,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
        format: str = "png",
    ) -> tuple[str, str, int, int, int]:
        del format
        image_bytes = base64.b64decode(base64_data)
        return self.save_generated_image_from_url(image_bytes=image_bytes, project_id=project_id, asset_id=asset_id)

    def save_generated_image_from_url(
        self,
        image_bytes: bytes,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
        format: str = "png",
    ) -> tuple[str, str, int, int, int]:
        del format
        return self._save_image_bytes(
            image_bytes=image_bytes,
            original_name="generated.avif",
            project_id=project_id,
            asset_id=asset_id,
        )

    @abstractmethod
    def open_asset_stream(self, storage_key: str) -> AssetStream:
        raise NotImplementedError

    @abstractmethod
    def iter_asset_stream(self, asset_stream: AssetStream) -> Iterator[bytes]:
        raise NotImplementedError

    @abstractmethod
    def read_asset_file(self, storage_key: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def delete_asset_files(self, storage_key: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def file_exists(self, storage_key: str) -> bool:
        raise NotImplementedError


class LocalStorageBackend(StorageBackendBase):
    """Filesystem-backed asset storage for local development."""

    name = "local"

    def __init__(self, *, base_path: Path | str | None = None) -> None:
        resolved = Path(base_path) if base_path is not None else _default_local_storage_path()
        self.base_path = resolved.expanduser()

    def _resolve_asset_path(self, storage_key: str) -> tuple[str, Path]:
        normalized = self._normalize_storage_key(storage_key)
        base_path = self.base_path.resolve()
        candidate = (base_path / normalized).resolve()
        try:
            candidate.relative_to(base_path)
        except ValueError as exc:
            raise ValueError("storage key escapes the asset storage base path") from exc
        return normalized, candidate

    def _write_asset_bytes(self, *, storage_key: str, body: bytes, mime_type: str) -> None:
        del mime_type
        _, full_path = self._resolve_asset_path(storage_key)
        try:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_bytes(body)
        except OSError as exc:
            raise AssetStorageUnavailableError(f"Failed to write asset file: {storage_key}") from exc

    def open_asset_stream(self, storage_key: str) -> AssetStream:
        normalized, full_path = self._resolve_asset_path(storage_key)
        try:
            file_handle = full_path.open("rb")
        except FileNotFoundError as exc:
            raise AssetFileNotFoundError(f"Asset file not found: {normalized}") from exc
        except OSError as exc:
            raise AssetStorageUnavailableError(f"Asset storage access failed for: {normalized}") from exc

        try:
            stat = full_path.stat()
        except OSError as exc:
            file_handle.close()
            raise AssetStorageUnavailableError(f"Asset storage access failed for: {normalized}") from exc

        last_modified = format_datetime(datetime.fromtimestamp(stat.st_mtime, timezone.utc), usegmt=True)
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'

        return AssetStream(
            body=file_handle,
            content_type=self._get_mime_type(normalized),
            content_length=int(stat.st_size),
            etag=etag,
            last_modified=last_modified,
            cache_control=_CACHE_CONTROL,
        )

    def iter_asset_stream(self, asset_stream: AssetStream) -> Iterator[bytes]:
        try:
            while True:
                chunk = asset_stream.body.read(_STREAM_CHUNK_SIZE)
                if not chunk:
                    break
                yield chunk
        finally:
            asset_stream.body.close()

    def read_asset_file(self, storage_key: str) -> bytes:
        normalized, full_path = self._resolve_asset_path(storage_key)
        try:
            return full_path.read_bytes()
        except FileNotFoundError as exc:
            raise AssetFileNotFoundError(f"Asset file not found: {normalized}") from exc
        except OSError as exc:
            raise AssetStorageUnavailableError(f"Asset storage access failed for: {normalized}") from exc

    def delete_asset_files(self, storage_key: str) -> None:
        normalized, full_path = self._resolve_asset_path(storage_key)
        try:
            full_path.unlink(missing_ok=True)
        except OSError as exc:
            raise AssetStorageUnavailableError(f"Failed to delete asset file: {normalized}") from exc

    def file_exists(self, storage_key: str) -> bool:
        _normalized, full_path = self._resolve_asset_path(storage_key)
        return full_path.is_file()


class S3StorageBackend(StorageBackendBase):
    """S3-backed asset storage."""

    name = "s3"

    def __init__(self) -> None:
        self._client: Any | None = None

    @property
    def bucket_name(self) -> str:
        return self._require_env("S3_BUCKET_NAME")

    @property
    def region(self) -> str:
        return self._require_env("S3_REGION")

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import boto3
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError("boto3 is required for S3 asset storage") from exc
            self._client = boto3.client("s3", region_name=self.region)
        return self._client

    def _wrap_storage_error(self, exc: Exception, *, storage_key: str) -> Exception:
        error_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            return AssetFileNotFoundError(f"Asset file not found: {storage_key}")
        if error_code in {"403", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"}:
            return AssetStorageUnavailableError(f"Asset storage access failed for: {storage_key}")
        return AssetStorageUnavailableError(f"Asset storage request failed for: {storage_key}")

    def _write_asset_bytes(self, *, storage_key: str, body: bytes, mime_type: str) -> None:
        self._get_client().put_object(
            Bucket=self.bucket_name,
            Key=storage_key,
            Body=body,
            ContentType=mime_type,
            CacheControl=_CACHE_CONTROL,
        )

    def open_asset_stream(self, storage_key: str) -> AssetStream:
        normalized = self._normalize_storage_key(storage_key)
        try:
            response = self._get_client().get_object(Bucket=self.bucket_name, Key=normalized)
        except Exception as exc:
            raise self._wrap_storage_error(exc, storage_key=normalized) from exc

        body = response["Body"]
        content_length_raw = response.get("ContentLength")
        content_length = int(content_length_raw) if isinstance(content_length_raw, int) else None
        etag = response.get("ETag")
        last_modified = response.get("LastModified")

        return AssetStream(
            body=body,
            content_type=str(response.get("ContentType") or self._get_mime_type(normalized)),
            content_length=content_length,
            etag=str(etag) if etag else None,
            last_modified=(
                format_datetime(last_modified.astimezone(timezone.utc), usegmt=True)
                if last_modified is not None
                else None
            ),
            cache_control=str(response.get("CacheControl") or _CACHE_CONTROL),
        )

    def iter_asset_stream(self, asset_stream: AssetStream) -> Iterator[bytes]:
        try:
            yield from asset_stream.body.iter_chunks(chunk_size=_STREAM_CHUNK_SIZE)
        finally:
            asset_stream.body.close()

    def read_asset_file(self, storage_key: str) -> bytes:
        normalized = self._normalize_storage_key(storage_key)
        try:
            response = self._get_client().get_object(Bucket=self.bucket_name, Key=normalized)
        except Exception as exc:
            raise self._wrap_storage_error(exc, storage_key=normalized) from exc
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def delete_asset_files(self, storage_key: str) -> None:
        normalized = self._normalize_storage_key(storage_key)
        self._get_client().delete_object(Bucket=self.bucket_name, Key=normalized)

    def file_exists(self, storage_key: str) -> bool:
        normalized = self._normalize_storage_key(storage_key)
        try:
            self._get_client().head_object(Bucket=self.bucket_name, Key=normalized)
            return True
        except Exception as exc:
            error_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise


class StorageService:
    """Selects and delegates to the configured asset storage backend."""

    def __init__(self, *, backend: StorageBackendBase | None = None) -> None:
        self._backend = backend or self._build_backend_from_env()

    def _build_backend_from_env(self) -> StorageBackendBase:
        backend_name = str(os.getenv("ASSET_STORAGE_BACKEND") or "s3").strip().lower()
        if backend_name not in _VALID_STORAGE_BACKENDS:
            allowed = ", ".join(sorted(_VALID_STORAGE_BACKENDS))
            raise RuntimeError(f"ASSET_STORAGE_BACKEND must be one of: {allowed}")

        if backend_name == "local":
            base_path_raw = str(os.getenv("LOCAL_ASSET_STORAGE_PATH") or "").strip()
            base_path = Path(base_path_raw) if base_path_raw else _default_local_storage_path()
            return LocalStorageBackend(base_path=base_path)

        return S3StorageBackend()

    @property
    def backend_name(self) -> str:
        return self._backend.name

    @property
    def base_path(self) -> Path | None:
        return getattr(self._backend, "base_path", None)

    def build_public_asset_path(self, storage_key: str) -> str:
        return self._backend.build_public_asset_path(storage_key)

    def to_png_bytes(self, image_bytes: bytes) -> bytes:
        return self._backend.to_png_bytes(image_bytes)

    def save_uploaded_file(
        self,
        file_content: bytes,
        original_filename: str,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
    ) -> tuple[str, str, int, int, int]:
        return self._backend.save_uploaded_file(file_content, original_filename, project_id, asset_id)

    def save_raw_file(
        self,
        file_content: bytes,
        original_filename: str,
        project_id: uuid.UUID,
        *,
        storage_prefix: str,
        mime_type: str | None = None,
    ) -> tuple[str, str, int]:
        return self._backend.save_raw_file(
            file_content,
            original_filename,
            project_id,
            storage_prefix=storage_prefix,
            mime_type=mime_type,
        )

    def save_generated_image(
        self,
        base64_data: str,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
        format: str = "png",
    ) -> tuple[str, str, int, int, int]:
        return self._backend.save_generated_image(base64_data, project_id, asset_id, format)

    def save_generated_image_from_url(
        self,
        image_bytes: bytes,
        project_id: uuid.UUID,
        asset_id: uuid.UUID,
        format: str = "png",
    ) -> tuple[str, str, int, int, int]:
        return self._backend.save_generated_image_from_url(image_bytes, project_id, asset_id, format)

    def open_asset_stream(self, storage_key: str) -> AssetStream:
        return self._backend.open_asset_stream(storage_key)

    def iter_asset_stream(self, asset_stream: AssetStream) -> Iterator[bytes]:
        return self._backend.iter_asset_stream(asset_stream)

    def read_asset_file(self, storage_key: str) -> bytes:
        return self._backend.read_asset_file(storage_key)

    def delete_asset_files(self, storage_key: str) -> None:
        self._backend.delete_asset_files(storage_key)

    def file_exists(self, storage_key: str) -> bool:
        return self._backend.file_exists(storage_key)


storage_service = StorageService()
