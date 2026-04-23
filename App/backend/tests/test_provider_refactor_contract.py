from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = ROOT / "App" / "backend"
LEGACY_MODULE_PREFIXES = (
    "App.backend.provider_engine",
    "App.backend.image_engine",
    "App.backend.providers.llm",
    "App.backend.providers.base",
    "App.backend.providers.contracts",
    "App.backend.providers.parsing",
    "App.backend.providers.transport",
)


def _iter_python_sources() -> list[Path]:
    sources: list[Path] = []
    for path in BACKEND_ROOT.rglob("*.py"):
        rel = path.relative_to(BACKEND_ROOT)
        if rel.parts and rel.parts[0] == "tests":
            continue
        if "__pycache__" in rel.parts:
            continue
        sources.append(path)
    return sources


def test_backend_source_tree_uses_provider_centric_imports() -> None:
    offenders: list[str] = []

    for path in _iter_python_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith(LEGACY_MODULE_PREFIXES):
                        offenders.append(f"{path.relative_to(ROOT)} -> import {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if module.startswith(LEGACY_MODULE_PREFIXES):
                    offenders.append(f"{path.relative_to(ROOT)} -> from {module}")
                elif any(alias.name == "ProviderRegistry" for alias in node.names):
                    offenders.append(f"{path.relative_to(ROOT)} -> ProviderRegistry")
            elif isinstance(node, ast.Name) and node.id == "ProviderRegistry":
                offenders.append(f"{path.relative_to(ROOT)} -> ProviderRegistry")

    assert offenders == []
