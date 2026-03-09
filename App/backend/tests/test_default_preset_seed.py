from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from App.backend.services.default_preset_seed import load_default_preset_seed


def test_default_preset_seed_has_expected_counts() -> None:
    seed = load_default_preset_seed()

    assert seed.preset_name == "Default"
    assert seed.preset_description is None
    assert len(seed.scenarios) == 15
    assert len(seed.fragments) == 21
    assert len(seed.variables) == 1
    assert len(seed.sub_agents) == 6


def test_default_preset_sub_agents_match_prompt_scenarios() -> None:
    seed = load_default_preset_seed()

    assert {item.agent_name for item in seed.sub_agents} == {
        item.task_subtype for item in seed.scenarios if item.task_type == "subAgent"
    }


def test_runtime_sources_no_longer_reference_legacy_default_prompt_paths() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    runtime_sources = [
        backend_root / "services" / "preset_service.py",
        backend_root / "routes" / "fragment_routes.py",
        backend_root / "services" / "template_engine.py",
        backend_root / "main.py",
    ]

    for path in runtime_sources:
        source = path.read_text(encoding="utf-8")
        assert "prompts/default_fragments" not in source
        assert "prompts/templates" not in source
        assert "from ..prompts import" not in source


def test_migration_0005_is_self_contained() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "alembic" / "versions" / "0005_reset_native_output_fragments.py").read_text(
        encoding="utf-8"
    )

    assert "FRAGMENT_CONTENTS =" in source
    assert "default_fragments" not in source
    assert "read_text(" not in source
