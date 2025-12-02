"""Storage service for managing asset files"""
import os
import uuid
import base64
import hashlib
from pathlib import Path
from typing import Optional, Tuple
from datetime import datetime
from PIL import Image
import io

# Storage configuration
STORAGE_BASE_PATH = Path(__file__).parent.parent / "storage" / "assets"
THUMBNAIL_SIZE = (256, 256)


class StorageService:
    """Service for managing asset file storage"""

    def __init__(self, base_path: Optional[Path] = None):
        self.base_path = base_path or STORAGE_BASE_PATH
        self._ensure_storage_directories()

    def _ensure_storage_directories(self) -> None:
        """Create storage directories if they don't exist"""
        self.base_path.mkdir(parents=True, exist_ok=True)
        (self.base_path / "originals").mkdir(exist_ok=True)
        (self.base_path / "thumbnails").mkdir(exist_ok=True)

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
        }
        return mime_types.get(ext, "image/png")

    def save_uploaded_file(
        self,
        file_content: bytes,
        original_filename: str,
        project_id: uuid.UUID
    ) -> Tuple[str, str, str, int, int, int]:
        """
        Save an uploaded file to storage.

        Args:
            file_content: Raw file bytes
            original_filename: Original filename from upload
            project_id: Project UUID

        Returns:
            Tuple of (file_path, thumbnail_path, mime_type, width, height, file_size)
        """
        filename = self._generate_filename(original_filename, project_id)
        file_path = self.base_path / "originals" / filename

        # Save original file
        file_path.write_bytes(file_content)

        # Get image dimensions and create thumbnail
        width, height = 0, 0
        thumbnail_path = ""

        try:
            with Image.open(io.BytesIO(file_content)) as img:
                width, height = img.size
                thumbnail_path = self._create_thumbnail(img, filename)
        except Exception:
            # Not a valid image or can't create thumbnail
            pass

        mime_type = self._get_mime_type(filename)
        file_size = len(file_content)

        # Return relative paths from storage base
        return (
            f"originals/{filename}",
            thumbnail_path,
            mime_type,
            width,
            height,
            file_size
        )

    def save_generated_image(
        self,
        base64_data: str,
        project_id: uuid.UUID,
        format: str = "png"
    ) -> Tuple[str, str, str, int, int, int]:
        """
        Save an AI-generated image from base64 data.

        Args:
            base64_data: Base64-encoded image data
            project_id: Project UUID
            format: Image format (png, jpg, webp)

        Returns:
            Tuple of (file_path, thumbnail_path, mime_type, width, height, file_size)
        """
        # Decode base64
        image_data = base64.b64decode(base64_data)

        # Generate filename
        filename = self._generate_filename(f"generated.{format}", project_id)
        file_path = self.base_path / "originals" / filename

        # Save the image
        file_path.write_bytes(image_data)

        # Get dimensions and create thumbnail
        width, height = 0, 0
        thumbnail_path = ""

        try:
            with Image.open(io.BytesIO(image_data)) as img:
                width, height = img.size
                thumbnail_path = self._create_thumbnail(img, filename)
        except Exception:
            pass

        mime_type = self._get_mime_type(filename)
        file_size = len(image_data)

        return (
            f"originals/{filename}",
            thumbnail_path,
            mime_type,
            width,
            height,
            file_size
        )

    def save_generated_image_from_url(
        self,
        image_bytes: bytes,
        project_id: uuid.UUID,
        format: str = "png"
    ) -> Tuple[str, str, str, int, int, int]:
        """
        Save an AI-generated image from raw bytes (downloaded from URL).

        Args:
            image_bytes: Raw image bytes
            project_id: Project UUID
            format: Image format (png, jpg, webp)

        Returns:
            Tuple of (file_path, thumbnail_path, mime_type, width, height, file_size)
        """
        filename = self._generate_filename(f"generated.{format}", project_id)
        file_path = self.base_path / "originals" / filename

        # Save the image
        file_path.write_bytes(image_bytes)

        # Get dimensions and create thumbnail
        width, height = 0, 0
        thumbnail_path = ""

        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                width, height = img.size
                thumbnail_path = self._create_thumbnail(img, filename)
        except Exception:
            pass

        mime_type = self._get_mime_type(filename)
        file_size = len(image_bytes)

        return (
            f"originals/{filename}",
            thumbnail_path,
            mime_type,
            width,
            height,
            file_size
        )

    def _create_thumbnail(self, img: Image.Image, filename: str) -> str:
        """Create a thumbnail for an image"""
        thumb_filename = f"thumb_{Path(filename).stem}.png"
        thumb_path = self.base_path / "thumbnails" / thumb_filename

        # Create thumbnail preserving aspect ratio
        img_copy = img.copy()
        img_copy.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)

        # Convert to RGB if necessary (for RGBA images)
        if img_copy.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img_copy.size, (255, 255, 255))
            if img_copy.mode == 'P':
                img_copy = img_copy.convert('RGBA')
            background.paste(img_copy, mask=img_copy.split()[-1] if img_copy.mode == 'RGBA' else None)
            img_copy = background

        img_copy.save(thumb_path, "PNG", optimize=True)

        return f"thumbnails/{thumb_filename}"

    def get_file_path(self, relative_path: str) -> Path:
        """Get the full file path for a relative storage path"""
        return self.base_path / relative_path

    def delete_file(self, relative_path: str) -> bool:
        """Delete a file from storage"""
        file_path = self.base_path / relative_path
        if file_path.exists():
            file_path.unlink()
            return True
        return False

    def delete_asset_files(self, file_path: str, thumbnail_path: Optional[str]) -> None:
        """Delete both original and thumbnail files for an asset"""
        self.delete_file(file_path)
        if thumbnail_path:
            self.delete_file(thumbnail_path)

    def file_exists(self, relative_path: str) -> bool:
        """Check if a file exists in storage"""
        return (self.base_path / relative_path).exists()


# Export singleton instance
storage_service = StorageService()
