"""Storage service for managing asset files"""
import os
import uuid
import base64
import hashlib
from pathlib import Path
from typing import Optional, Tuple
from datetime import datetime
from PIL import Image, ImageOps
import io

# Optional: registers AVIF support with Pillow when installed
try:
    import pillow_avif  # type: ignore  # noqa: F401
except ImportError:  # pragma: no cover
    pillow_avif = None  # type: ignore

# Storage configuration
STORAGE_BASE_PATH = Path(__file__).parent.parent / "storage" / "assets"


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


class StorageService:
    """Service for managing asset file storage"""

    def __init__(self, base_path: Optional[Path] = None):
        self.base_path = base_path or STORAGE_BASE_PATH
        self._ensure_storage_directories()

    def _ensure_storage_directories(self) -> None:
        """Create storage directories if they don't exist"""
        self.base_path.mkdir(parents=True, exist_ok=True)
        (self.base_path / "originals").mkdir(exist_ok=True)

    def _generate_filename(self, original_name: str, project_id: uuid.UUID) -> str:
        """Generate a unique filename preserving the original extension"""
        ext = Path(original_name).suffix.lower() or ".png"
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        return f"{project_id}_{timestamp}_{unique_id}{ext}"

    def _get_mime_type(self, filename: str) -> str:
        """Get MIME type from filename extension"""
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

        # Ensure save-compatible mode
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
        project_id: uuid.UUID
    ) -> Tuple[str, str, int, int, int]:
        """
        Save an uploaded file to storage.

        Args:
            file_content: Raw file bytes
            original_filename: Original filename from upload
            project_id: Project UUID

        Returns:
            Tuple of (file_path, mime_type, width, height, file_size)
        """
        output_name = f"{Path(original_filename).stem}.avif"
        filename = self._generate_filename(output_name, project_id)
        file_path = self.base_path / "originals" / filename

        # Decode to validate image, fix orientation, and (optionally) transcode to AVIF
        with Image.open(io.BytesIO(file_content)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size

            encoded_bytes = self._encode_avif(img)

            # Save original file (possibly transcoded)
            file_path.write_bytes(encoded_bytes)

        mime_type = self._get_mime_type(filename)
        file_size = len(encoded_bytes)

        # Return relative paths from storage base
        return (
            f"originals/{filename}",
            mime_type,
            width,
            height,
            file_size,
        )

    def save_generated_image(
        self,
        base64_data: str,
        project_id: uuid.UUID,
        format: str = "png"
    ) -> Tuple[str, str, int, int, int]:
        """
        Save an AI-generated image from base64 data.

        Args:
            base64_data: Base64-encoded image data
            project_id: Project UUID
            format: Image format (png, jpg, webp)

        Returns:
            Tuple of (file_path, mime_type, width, height, file_size)
        """
        # Decode base64
        image_bytes = base64.b64decode(base64_data)

        # Generate filename
        output_ext = "avif"
        filename = self._generate_filename(f"generated.{output_ext}", project_id)
        file_path = self.base_path / "originals" / filename

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size

            encoded_bytes = self._encode_avif(img)
            file_path.write_bytes(encoded_bytes)

        mime_type = self._get_mime_type(filename)
        file_size = len(encoded_bytes)

        return (
            f"originals/{filename}",
            mime_type,
            width,
            height,
            file_size,
        )

    def save_generated_image_from_url(
        self,
        image_bytes: bytes,
        project_id: uuid.UUID,
        format: str = "png"
    ) -> Tuple[str, str, int, int, int]:
        """
        Save an AI-generated image from raw bytes (downloaded from URL).

        Args:
            image_bytes: Raw image bytes
            project_id: Project UUID
            format: Image format (png, jpg, webp)

        Returns:
            Tuple of (file_path, mime_type, width, height, file_size)
        """
        output_ext = "avif"
        filename = self._generate_filename(f"generated.{output_ext}", project_id)
        file_path = self.base_path / "originals" / filename

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size

            encoded_bytes = self._encode_avif(img)
            file_path.write_bytes(encoded_bytes)

        mime_type = self._get_mime_type(filename)
        file_size = len(encoded_bytes)

        return (
            f"originals/{filename}",
            mime_type,
            width,
            height,
            file_size,
        )

    def get_file_path(self, relative_path: str) -> Path:
        """Get the full file path for a relative storage path"""
        return self.base_path / relative_path

    def read_asset_file(self, relative_path: str) -> bytes:
        """
        Read an asset file and return its bytes.

        Args:
            relative_path: Relative path from storage base (e.g., "originals/filename.png")

        Returns:
            Raw file bytes

        Raises:
            FileNotFoundError: If the file doesn't exist
        """
        full_path = self.base_path / relative_path
        if not full_path.exists():
            raise FileNotFoundError(f"Asset file not found: {relative_path}")
        return full_path.read_bytes()

    def delete_file(self, relative_path: str) -> bool:
        """Delete a file from storage"""
        file_path = self.base_path / relative_path
        if file_path.exists():
            file_path.unlink()
            return True
        return False

    def delete_asset_files(self, file_path: str) -> None:
        """Delete the stored file for an asset"""
        self.delete_file(file_path)

    def file_exists(self, relative_path: str) -> bool:
        """Check if a file exists in storage"""
        return (self.base_path / relative_path).exists()


# Export singleton instance
storage_service = StorageService()
