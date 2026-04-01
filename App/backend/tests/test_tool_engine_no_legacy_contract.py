from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOL_ENGINE_ROOT = ROOT / "services" / "tool_engine"


def _python_sources(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if path.is_file())


def test_tool_engine_source_has_no_legacy_symbols() -> None:
    forbidden = (
        "ToolCallModule",
        "tool_call_module(",
        "legacy_specs_by_name",
        "legacy_result_to_outcome",
        "build_legacy_binding",
    )

    offenders: list[str] = []
    for path in _python_sources(TOOL_ENGINE_ROOT):
        source = path.read_text(encoding="utf-8")
        for token in forbidden:
            if token in source:
                offenders.append(f"{path.relative_to(ROOT)}::{token}")

    assert offenders == []


def test_legacy_tool_engine_module_files_are_deleted() -> None:
    deleted = [
        "read_module.py",
        "create_module.py",
        "replace_module.py",
        "patch_module.py",
        "delete_module.py",
        "translate_module.py",
        "patch_translation_module.py",
        "search_module.py",
        "tree_module.py",
        "call_module.py",
        "generate_module.py",
        "mcp_module.py",
    ]

    existing = [
        str((TOOL_ENGINE_ROOT / "modules" / name).relative_to(ROOT))
        for name in deleted
        if (TOOL_ENGINE_ROOT / "modules" / name).exists()
    ]
    assert existing == []


def test_tests_do_not_import_deleted_tool_engine_modules() -> None:
    current_file = Path(__file__).resolve()
    deleted_modules = (
        "read_module",
        "create_module",
        "replace_module",
        "patch_module",
        "delete_module",
        "translate_module",
        "patch_translation_module",
        "search_module",
        "tree_module",
        "call_module",
        "generate_module",
        "mcp_module",
    )
    offenders: list[str] = []
    for path in _python_sources(ROOT / "tests"):
        if path == current_file:
            continue
        source = path.read_text(encoding="utf-8")
        for module_name in deleted_modules:
            dotted = f"App.backend.services.tool_engine.modules.{module_name}"
            if dotted in source:
                offenders.append(f"{path.relative_to(ROOT)}::{module_name}")
    assert offenders == []
