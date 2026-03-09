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


def test_alembic_versions_include_baseline() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    version_files = sorted(
        path.name
        for path in (backend_root / "alembic" / "versions").glob("*.py")
    )

    assert "0001_baseline.py" in version_files
