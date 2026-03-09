"""S3-backed storage service for managing asset files."""

from __future__ import annotations

import base64
import io
import os
import uuid
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


class AssetFileNotFoundError(FileNotFoundError):
    """Raised when an S3-backed asset does not exist."""


class AssetStorageUnavailableError(RuntimeError):
    """Raised when S3 cannot serve an asset because of auth or transient failures."""


@dataclass
class AssetStream:
    """Proxy-friendly S3 stream payload and response metadata."""

    body: Any
    content_type: str
    content_length: int | None
    etag: str | None
    last_modified: str | None
    cache_control: str


class StorageService:
    """Service for managing asset storage in S3."""

    def __init__(self) -> None:
        self._client: Any | None = None

    def _require_env(self, name: str) -> str:
        value = str(os.getenv(name) or "").strip()
        if not value:
            raise RuntimeError(f"{name} must be set for asset storage")
        return value

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

    def _normalize_storage_key(self, storage_key: str) -> str:
        normalized = str(storage_key or "").lstrip("/")
        if not normalized:
            raise ValueError("storage key is required")
        return normalized

    def _generate_filename(self, original_name: str, project_id: uuid.UUID) -> str:
        """Generate a unique filename preserving the original extension."""
        ext = Path(original_name).suffix.lower() or ".png"
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        return f"{project_id}_{timestamp}_{unique_id}{ext}"

    def _get_mime_type(self, filename: str) -> str:
        """Get MIME type from filename extension."""
        ext = Path(filename).suffix.lower()
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".avif": "image/avif",
        }
        return mime_types.get(ext, "image/png")

    def _ensure_avif_supported(self) -> None:
        # pillow-avif-plugin registers ".avif" -> "AVIF"
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

    def _upload_asset_bytes(self, *, storage_key: str, body: bytes, mime_type: str) -> None:
        self._get_client().put_object(
            Bucket=self.bucket_name,
            Key=storage_key,
            Body=body,
            ContentType=mime_type,
            CacheControl=_CACHE_CONTROL,
        )

    def build_public_asset_path(self, storage_key: str) -> str:
        return f"/storage/assets/{self._normalize_storage_key(storage_key)}"

    def _wrap_storage_error(self, exc: Exception, *, storage_key: str) -> Exception:
        error_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            return AssetFileNotFoundError(f"Asset file not found: {storage_key}")
        if error_code in {"403", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"}:
            return AssetStorageUnavailableError(f"Asset storage access failed for: {storage_key}")
        return AssetStorageUnavailableError(f"Asset storage request failed for: {storage_key}")

    def open_asset_stream(self, storage_key: str) -> AssetStream:
        """Open an S3 asset for streaming through the backend proxy."""
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
        """Yield S3 object bytes in chunks and close the underlying stream afterwards."""
        try:
            yield from asset_stream.body.iter_chunks(chunk_size=_STREAM_CHUNK_SIZE)
        finally:
            asset_stream.body.close()

    def to_png_bytes(self, image_bytes: bytes) -> bytes:
        """Convert arbitrary image bytes to PNG bytes (for provider reference images)."""
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
    ) -> tuple[str, str, int, int, int]:
        """Validate an uploaded image, convert it to AVIF, and store it in S3."""
        output_name = f"{Path(original_filename).stem}.avif"
        filename = self._generate_filename(output_name, project_id)
        storage_key = self._normalize_storage_key(f"originals/{filename}")

        with Image.open(io.BytesIO(file_content)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            encoded_bytes = self._encode_avif(img)

        mime_type = self._get_mime_type(filename)
        self._upload_asset_bytes(storage_key=storage_key, body=encoded_bytes, mime_type=mime_type)
        return storage_key, mime_type, width, height, len(encoded_bytes)

    def save_generated_image(
        self,
        base64_data: str,
        project_id: uuid.UUID,
        format: str = "png",
    ) -> tuple[str, str, int, int, int]:
        """Save an AI-generated image from base64 data to S3."""
        del format
        image_bytes = base64.b64decode(base64_data)
        return self.save_generated_image_from_url(image_bytes=image_bytes, project_id=project_id)

    def save_generated_image_from_url(
        self,
        image_bytes: bytes,
        project_id: uuid.UUID,
        format: str = "png",
    ) -> tuple[str, str, int, int, int]:
        """Save an AI-generated image from raw bytes to S3."""
        del format
        filename = self._generate_filename("generated.avif", project_id)
        storage_key = self._normalize_storage_key(f"originals/{filename}")

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            encoded_bytes = self._encode_avif(img)

        mime_type = self._get_mime_type(filename)
        self._upload_asset_bytes(storage_key=storage_key, body=encoded_bytes, mime_type=mime_type)
        return storage_key, mime_type, width, height, len(encoded_bytes)

    def read_asset_file(self, storage_key: str) -> bytes:
        """Read an asset file from S3 and return its bytes."""
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
        """Delete the stored file for an asset from S3."""
        normalized = self._normalize_storage_key(storage_key)
        self._get_client().delete_object(Bucket=self.bucket_name, Key=normalized)

    def file_exists(self, storage_key: str) -> bool:
        """Check if a file exists in S3."""
        normalized = self._normalize_storage_key(storage_key)
        try:
            self._get_client().head_object(Bucket=self.bucket_name, Key=normalized)
            return True
        except Exception as exc:
            error_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise


storage_service = StorageService()
