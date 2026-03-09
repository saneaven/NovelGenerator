from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from App.backend.scripts import reconcile_asset_storage


class _FakeQuery:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])

    def all(self) -> list[object]:
        return list(self._rows)


class _FakeSession:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])
        self.closed = False

    def query(self, _model: object) -> _FakeQuery:
        return _FakeQuery(self._rows)

    def close(self) -> None:
        self.closed = True

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None


def test_reconcile_asset_storage_runs_in_local_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    originals_path = tmp_path / "originals"
    originals_path.mkdir(parents=True)
    (originals_path / "sample.avif").write_bytes(b"test")

    fake_session = _FakeSession(rows=[])
    monkeypatch.setattr(
        reconcile_asset_storage,
        "storage_service",
        SimpleNamespace(backend_name="local", base_path=tmp_path),
    )
    monkeypatch.setattr(reconcile_asset_storage, "SessionLocal", lambda: fake_session)
    monkeypatch.setattr(sys, "argv", ["reconcile_asset_storage"])

    result = reconcile_asset_storage.main()

    assert result == 0
    assert fake_session.closed is True


def test_reconcile_asset_storage_exits_for_s3_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        reconcile_asset_storage,
        "storage_service",
        SimpleNamespace(backend_name="s3", base_path=None),
    )
    monkeypatch.setattr(sys, "argv", ["reconcile_asset_storage"])

    with pytest.raises(SystemExit, match="only supports local asset storage"):
        reconcile_asset_storage.main()
