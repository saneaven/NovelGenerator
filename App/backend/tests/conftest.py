from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from _pytest.python import Module


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")


_ISOLATED_MODULE_PREFIXES = ("App.backend",)
_ISOLATED_MODULE_NAMES = {
    "database",
    "jose",
    "mistune",
    "openai",
}


def _should_restore_module(module_name: str) -> bool:
    return module_name in _ISOLATED_MODULE_NAMES or module_name.startswith(_ISOLATED_MODULE_PREFIXES)


def _restore_sys_modules(snapshot: dict[str, object], *, keep: set[str]) -> None:
    snapshot_names = set(snapshot)

    for module_name in list(sys.modules):
        if module_name in keep or module_name in snapshot_names or not _should_restore_module(module_name):
            continue
        sys.modules.pop(module_name, None)

    for module_name, module in snapshot.items():
        if module_name in keep or not _should_restore_module(module_name):
            continue
        if sys.modules.get(module_name) is not module:
            sys.modules[module_name] = module


class _IsolatedImportModule(Module):
    def _getobj(self):
        snapshot = dict(sys.modules)
        module = super()._getobj()
        _restore_sys_modules(snapshot, keep={module.__name__})
        return module


def pytest_pycollect_makemodule(module_path: Path, parent):
    if module_path.name.startswith("test_") and module_path.suffix == ".py":
        return _IsolatedImportModule.from_parent(parent, path=module_path)
    return None


@pytest.fixture(autouse=True)
def _restore_sys_modules_between_tests():
    snapshot = dict(sys.modules)
    yield
    _restore_sys_modules(snapshot, keep=set())
