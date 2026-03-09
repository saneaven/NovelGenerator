from __future__ import annotations

import base64
import importlib
import os
import sys
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from PIL import Image

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _png_bytes(*, size: tuple[int, int] = (4, 3), color: tuple[int, int, int, int] = (12, 34, 56, 255)) -> bytes:
    out = BytesIO()
    Image.new("RGBA", size, color).save(out, format="PNG")
    return out.getvalue()


def _reload_storage_service_module(monkeypatch: pytest.MonkeyPatch, *, backend_name: str, tmp_path=None):
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", backend_name)
    if tmp_path is None:
        monkeypatch.delenv("LOCAL_ASSET_STORAGE_PATH", raising=False)
    else:
        monkeypatch.setenv("LOCAL_ASSET_STORAGE_PATH", str(tmp_path))
    monkeypatch.setenv("S3_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("S3_REGION", "us-west-2")

    import App.backend.services.storage_service as storage_service_module

    return importlib.reload(storage_service_module)


def test_storage_service_selects_local_backend_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    storage_service_module = _reload_storage_service_module(monkeypatch, backend_name="local", tmp_path=tmp_path)

    assert storage_service_module.storage_service.backend_name == "local"
    assert storage_service_module.storage_service.base_path == tmp_path
    assert isinstance(storage_service_module.storage_service._backend, storage_service_module.LocalStorageBackend)


def test_storage_service_selects_s3_backend_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    storage_service_module = _reload_storage_service_module(monkeypatch, backend_name="s3")

    assert storage_service_module.storage_service.backend_name == "s3"
    assert storage_service_module.storage_service.base_path is None
    assert isinstance(storage_service_module.storage_service._backend, storage_service_module.S3StorageBackend)


def test_local_storage_backend_round_trip(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    storage_service_module = _reload_storage_service_module(monkeypatch, backend_name="local", tmp_path=tmp_path)
    storage = storage_service_module.StorageService(
        backend=storage_service_module.LocalStorageBackend(base_path=tmp_path)
    )
    project_id = uuid4()
    uploaded_png = _png_bytes(size=(8, 6))

    storage_key, mime_type, width, height, file_size = storage.save_uploaded_file(
        uploaded_png,
        "cover.png",
        project_id,
    )

    assert storage_key.startswith("originals/")
    assert mime_type == "image/avif"
    assert (width, height) == (8, 6)
    assert file_size > 0
    assert (tmp_path / storage_key).is_file()
    assert storage.file_exists(storage_key) is True
    assert storage.build_public_asset_path(storage_key) == f"/storage/assets/{storage_key}"
    assert storage.to_png_bytes(uploaded_png) == uploaded_png

    stored_bytes = storage.read_asset_file(storage_key)
    assert len(stored_bytes) == file_size

    asset_stream = storage.open_asset_stream(storage_key)
    streamed = b"".join(storage.iter_asset_stream(asset_stream))
    assert streamed == stored_bytes
    assert asset_stream.content_type == "image/avif"
    assert asset_stream.content_length == file_size
    assert asset_stream.last_modified is not None
    assert asset_stream.cache_control == "public, max-age=31536000, immutable"

    generated_key, generated_mime, generated_width, generated_height, generated_size = storage.save_generated_image(
        base64.b64encode(uploaded_png).decode("ascii"),
        project_id,
    )
    assert generated_key.startswith("originals/")
    assert generated_mime == "image/avif"
    assert (generated_width, generated_height) == (8, 6)
    assert generated_size > 0
    assert storage.file_exists(generated_key) is True

    storage.delete_asset_files(storage_key)
    storage.delete_asset_files(generated_key)
    assert storage.file_exists(storage_key) is False
    assert storage.file_exists(generated_key) is False


def test_local_storage_backend_blocks_path_traversal(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    storage_service_module = _reload_storage_service_module(monkeypatch, backend_name="local", tmp_path=tmp_path)
    backend = storage_service_module.LocalStorageBackend(base_path=tmp_path)

    with pytest.raises(ValueError, match="escapes the asset storage base path"):
        backend.read_asset_file("../escape.png")


def test_proxy_asset_serves_local_storage(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    storage_service_module = _reload_storage_service_module(monkeypatch, backend_name="local", tmp_path=tmp_path)
    storage = storage_service_module.storage_service
    project_id = uuid4()
    storage_key, _mime_type, _width, _height, file_size = storage.save_uploaded_file(
        _png_bytes(size=(5, 5)),
        "scene.png",
        project_id,
    )

    import App.backend.services.asset_proxy as asset_proxy_module

    response = asset_proxy_module.build_asset_proxy_response(storage_key, storage=storage)

    assert response.status_code == 200
    assert storage.read_asset_file(storage_key)
    assert response.media_type == "image/avif"
    assert response.headers["content-type"].startswith("image/avif")
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert int(response.headers["content-length"]) == file_size
