from __future__ import annotations

import base64
import asyncio
import importlib
import os
import sys
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from starlette.requests import Request

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from App.backend.auth import security
from App.backend.models.db_models import Asset, Project, User


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


def _extract_filter_value(criteria: list[object], column_name: str):
    for criterion in criteria:
        left = getattr(criterion, "left", None)
        right = getattr(criterion, "right", None)

        if getattr(left, "name", None) == column_name and hasattr(right, "value"):
            return right.value
        if getattr(right, "name", None) == column_name and hasattr(left, "value"):
            return left.value

    return None


class _FakeQuery:
    def __init__(self, db: "_FakeDb", model: type[object]) -> None:
        self._db = db
        self._model = model
        self._criteria: list[object] = []

    def join(self, *_args, **_kwargs) -> "_FakeQuery":
        return self

    def filter(self, *criteria) -> "_FakeQuery":
        self._criteria.extend(criteria)
        return self

    def first(self):
        if self._model is User:
            user_id = _extract_filter_value(self._criteria, "id")
            return self._db.users_by_id.get(user_id)

        if self._model is Asset:
            file_path = _extract_filter_value(self._criteria, "file_path")
            owner_id = _extract_filter_value(self._criteria, "user_id")
            asset = self._db.assets_by_path.get(file_path)
            if asset is None:
                return None

            project_owner = self._db.project_owner_by_id.get(asset.project_id)
            if project_owner != owner_id:
                return None
            return asset

        raise AssertionError(f"Unsupported model query: {self._model!r}")


class _FakeDb:
    def __init__(self, *, users: list[User], projects: list[Project], assets: list[Asset]) -> None:
        self.users_by_id = {user.id: user for user in users}
        self.project_owner_by_id = {project.id: project.user_id for project in projects}
        self.assets_by_path = {str(asset.file_path): asset for asset in assets}

    def query(self, model: type[object]) -> _FakeQuery:
        return _FakeQuery(self, model)


def _make_fake_db(*, asset_path: str) -> tuple[_FakeDb, User, User, Asset]:
    owner = User(
        id=uuid4(),
        email="owner@example.com",
        username="owner",
        password_hash="hashed",
        is_active=True,
        is_verified=True,
    )
    intruder = User(
        id=uuid4(),
        email="intruder@example.com",
        username="intruder",
        password_hash="hashed",
        is_active=True,
        is_verified=True,
    )
    project = Project(
        id=uuid4(),
        user_id=owner.id,
        name="Protected Project",
        description=None,
    )
    asset = Asset(
        id=uuid4(),
        project_id=project.id,
        name="scene",
        file_path=asset_path,
        mime_type="image/avif",
    )
    db = _FakeDb(users=[owner, intruder], projects=[project], assets=[asset])
    return db, owner, intruder, asset


class _TestCachedStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            response.headers.setdefault("cache-control", self.cache_control)
        return response


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

    fake_db, owner, _intruder, _asset = _make_fake_db(asset_path=storage_key)
    response = asset_proxy_module.build_asset_proxy_response(
        storage_key,
        user_id=owner.id,
        db=fake_db,
        storage=storage,
    )

    assert response.status_code == 200
    assert storage.read_asset_file(storage_key)
    assert response.media_type == "image/avif"
    assert response.headers["content-type"].startswith("image/avif")
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["vary"] == "Authorization"
    assert int(response.headers["content-length"]) == file_size


def test_proxy_asset_hides_unauthorized_asset_as_not_found(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    storage_service_module = _reload_storage_service_module(monkeypatch, backend_name="local", tmp_path=tmp_path)
    storage = storage_service_module.storage_service
    storage_key, _mime_type, _width, _height, _file_size = storage.save_uploaded_file(
        _png_bytes(size=(5, 5)),
        "scene.png",
        uuid4(),
    )

    import App.backend.services.asset_proxy as asset_proxy_module

    fake_db, _owner, intruder, _asset = _make_fake_db(asset_path=storage_key)

    with pytest.raises(asset_proxy_module.HTTPException) as exc_info:
        asset_proxy_module.build_asset_proxy_response(
            storage_key,
            user_id=intruder.id,
            db=fake_db,
            storage=storage,
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Asset not found"


def test_http_bearer_rejects_missing_authorization_header() -> None:
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/storage/assets/originals/protected.avif",
            "headers": [],
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(security(request))

    assert exc_info.value.status_code in {401, 403}


def test_storage_resources_remain_public(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    static_files = _TestCachedStaticFiles(
        directory=str(tmp_path),
        cache_control="public, max-age=1800",
    )

    async def fake_get_response(self, path: str, scope):
        del self, path, scope
        return PlainTextResponse("public resource")

    monkeypatch.setattr(StaticFiles, "get_response", fake_get_response)

    response = asyncio.run(
        static_files.get_response(
            "sample.txt",
            {
                "type": "http",
                "method": "GET",
                "path": "/storage/resources/sample.txt",
                "headers": [],
            },
        )
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=1800"
