from __future__ import annotations

import asyncio
import builtins
import importlib
import sys
import types
from types import SimpleNamespace

fake_auth = types.ModuleType("App.backend.auth")
fake_auth.require_admin = lambda: None
sys.modules["App.backend.auth"] = fake_auth

fake_db_models = types.ModuleType("App.backend.models.db_models")
fake_db_models.User = type("User", (), {})
sys.modules["App.backend.models.db_models"] = fake_db_models

admin_memory_routes = importlib.import_module("App.backend.routes.admin_memory_routes")


def test_memory_summary_returns_diagnostic_sections() -> None:
    summary = asyncio.run(
        admin_memory_routes.get_memory_summary(current_admin=SimpleNamespace(is_admin=True))
    )
    payload = summary.model_dump()

    assert "process_status" in payload
    assert "smaps_rollup" in payload
    assert "fd" in payload
    assert "asyncio" in payload
    assert "gc" in payload
    assert "tracemalloc" in payload
    assert "VmRSS" in payload["process_status"]
    assert "Private_Dirty" in payload["smaps_rollup"]
    assert "count" in payload["gc"]
    assert "threshold" in payload["gc"]


def test_smaps_rollup_missing_returns_null_metrics(monkeypatch) -> None:
    original_open = builtins.open

    def _open(path, *args, **kwargs):
        if path == "/proc/self/smaps_rollup":
            raise OSError("missing")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _open)

    result = admin_memory_routes._read_smaps_rollup()

    assert set(result) == set(admin_memory_routes.SMAPS_ROLLUP_FIELDS)
    assert all(value is None for value in result.values())


def test_fd_snapshot_missing_proc_fd_returns_null_counts(monkeypatch) -> None:
    monkeypatch.setattr(admin_memory_routes.os, "listdir", lambda _path: (_ for _ in ()).throw(OSError("missing")))

    result = admin_memory_routes._build_fd_snapshot()

    assert result.total is None
    assert result.sockets is None
    assert result.regular_files is None
    assert result.other is None


def test_admin_memory_router_does_not_add_force_gc_action_endpoint() -> None:
    paths = {route.path for route in admin_memory_routes.router.routes}

    assert not any(path.endswith("/actions") for path in paths)
