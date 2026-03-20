from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from App.backend.services.default_preset_seed import load_default_preset_seed


def _load_default_prompt_document() -> dict:
    prompt_path = ROOT / "App" / "backend" / "prompts" / "Default.nbprompt"
    return json.loads(prompt_path.read_text(encoding="utf-8"))


def test_default_preset_seed_has_expected_counts() -> None:
    seed = load_default_preset_seed()

    assert seed.preset_name == "Default"
    assert seed.preset_description is None
    assert len(seed.scenarios) == 17
    assert len(seed.fragments) == 24
    assert len(seed.variables) == 1
    assert len(seed.sub_agents) == 7


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


def test_default_prompt_places_project_reference_and_guidelines_in_expected_sections() -> None:
    document = _load_default_prompt_document()

    agent_mode = document["prompts"]["agent"]["agentMode"]
    agent_system = agent_mode["system_template"]
    agent_last_user = agent_mode["blocks"][-1]["rangeMapping"]["user_template"]

    assert '{% include "fragment:common/basicInfo" %}' in agent_system
    assert '{% include "fragment:common/objectIndex" %}' in agent_system
    assert '{% include "fragment:common/guidelines" %}' not in agent_system
    assert '{% include "fragment:common/guidelines" %}' in agent_last_user
    assert '{% include "fragment:common/objectContext" %}' in agent_last_user
    assert '{% include "fragment:common/basicInfo" %}' not in agent_last_user
    assert '{% include "fragment:common/objectIndex" %}' not in agent_last_user

    project_data = document["prompts"]["editAssistant"]["projectData"]
    project_data_system = project_data["system_template"]
    project_data_last_user = project_data["blocks"][-1]["rangeMapping"]["user_template"]

    assert '{% if not editAssistant.projectData.basicInfo %}{% include "fragment:common/basicInfo" %}{% endif %}' in project_data_system
    assert '{% include "fragment:common/objectIndex" %}' in project_data_system
    assert '{% if not editAssistant.projectData.guidelines %}{% include "fragment:common/guidelines" %}{% endif %}' in project_data_last_user
    assert '{% include "fragment:common/objectContext" %}' in project_data_last_user


def test_default_prompt_story_entity_tool_docs_include_folder_id() -> None:
    document = _load_default_prompt_document()

    project_data_ops = document["fragments"]["common/editOperations"]["projectData"]["content"]
    project_data_native = document["fragments"]["common/nativeOutput"]["projectData"]["content"]

    assert "Optional `folderId` places it in a folder; use `null` for root." in project_data_ops
    assert "Optional `folderId` moves it to a folder; use `null` for root." in project_data_ops
    assert "`folderId` can be used together with create, replace, or patch to place or move a story entity." in project_data_ops
    assert '"folderId": "folder-main-cast"' in project_data_native
    assert '"folderId": null' in project_data_native


def test_default_prompt_outline_and_manuscript_fragments_include_number_attributes() -> None:
    document = _load_default_prompt_document()

    common_context = document["fragments"]["common"]["objectContext"]["content"]
    common_index = document["fragments"]["common"]["objectIndex"]["content"]
    translation_context = document["fragments"]["translation"]["objectContext"]["content"]
    translation_reference = document["fragments"]["translation"]["referenceContext"]["content"]

    # common fragments use tree-based rendering with node variable
    for fragment in (common_context, common_index):
        assert 'act-number="{{ node.actNumber|e }}"' in fragment
        assert 'chapter-number="{{ node.chapterNumber|e }}"' in fragment

    # translation fragments use exact/flat rendering with item variable
    for fragment in (translation_context, translation_reference):
        assert 'act-number="{{ item.actNumber|e }}"' in fragment
        assert 'chapter-number="{{ item.chapterNumber|e }}"' in fragment

    for fragment in (common_context, common_index):
        assert 'act-number="{{ manuscript.actNumber|e }}"' in fragment
        assert 'chapter-number="{{ manuscript.chapterNumber|e }}"' in fragment

    # translation objectContext uses manuscript variable
    assert 'act-number="{{ manuscript.actNumber|e }}"' in translation_context
    assert 'chapter-number="{{ manuscript.chapterNumber|e }}"' in translation_context

    # translation referenceContext uses this variable
    assert 'act-number="{{ this.actNumber|e }}"' in translation_reference
    assert 'chapter-number="{{ this.chapterNumber|e }}"' in translation_reference
