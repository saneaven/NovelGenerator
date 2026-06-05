from __future__ import annotations

import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from App.backend.services.default_preset_seed import load_default_preset_seed


def _load_alembic_revision_ids() -> list[str]:
    backend_root = Path(__file__).resolve().parents[1]
    revision_pattern = re.compile(r'^revision\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)
    revisions: list[str] = []
    for path in sorted((backend_root / "alembic" / "versions").glob("*.py")):
        match = revision_pattern.search(path.read_text(encoding="utf-8"))
        assert match is not None, f"Missing Alembic revision in {path.name}"
        revisions.append(match.group(1))
    return revisions


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


def test_alembic_revision_ids_fit_version_table_limit() -> None:
    revisions = _load_alembic_revision_ids()

    assert all(len(revision) <= 32 for revision in revisions), (
        "Alembic revision IDs must fit within alembic_version.version_num VARCHAR(32)"
    )


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


def test_default_scene_image_prompt_includes_story_position_context() -> None:
    document = _load_default_prompt_document()

    scene_prompt = document["prompts"]["imagePrompt"]["scene"]["blocks"][-1]["rangeMapping"]["user_template"]

    assert "### Current Story Position" in scene_prompt
    assert "**Act:** {{ imagePrompt.sceneChapter.actNumber }}" in scene_prompt
    assert "**Chapter:** {{ imagePrompt.sceneChapter.chapterNumber }}" in scene_prompt
    assert "**Chapter Title:** {{ imagePrompt.sceneChapter.chapterName }}" in scene_prompt
    assert "do not include act/chapter labels in the generated image prompt" in scene_prompt


def test_default_prompt_outline_and_manuscript_fragments_include_number_attributes() -> None:
    document = _load_default_prompt_document()

    common_context = document["fragments"]["common"]["objectContext"]["content"]
    common_index = document["fragments"]["common"]["objectIndex"]["content"]
    translation_context = document["fragments"]["translation"]["objectContext"]["content"]
    translation_reference = document["fragments"]["translation"]["referenceContext"]["content"]

    # common fragments use tree-based rendering, so outline numbering is emitted directly
    for fragment in (common_context, common_index):
        assert 'act-number="{{ node.actNumber|e }}"' in fragment
        assert 'chapter-number="{{ node.chapterNumber|e }}"' in fragment
        assert 'node.actNumber is defined' not in fragment
        assert 'node.chapterNumber is defined' not in fragment
        assert 'node.actNumber is not none' not in fragment
        assert 'node.chapterNumber is not none' not in fragment

    # translation fragments use exact/flat rendering, so None guards remain but defined guards do not
    for fragment in (translation_context, translation_reference):
        assert 'act-number="{{ item.actNumber|e }}"' in fragment
        assert 'chapter-number="{{ item.chapterNumber|e }}"' in fragment
        assert 'item.actNumber is defined' not in fragment
        assert 'item.chapterNumber is defined' not in fragment
        assert 'item.actNumber is not none' in fragment
        assert 'item.chapterNumber is not none' in fragment

    for fragment in (common_context, common_index):
        assert 'act-number="{{ manuscript.actNumber|e }}"' in fragment
        assert 'chapter-number="{{ manuscript.chapterNumber|e }}"' in fragment
        assert 'manuscript.actNumber is defined' not in fragment
        assert 'manuscript.chapterNumber is defined' not in fragment
        assert 'manuscript.actNumber is not none' in fragment
        assert 'manuscript.chapterNumber is not none' in fragment

    # translation objectContext uses manuscript variable
    assert 'act-number="{{ manuscript.actNumber|e }}"' in translation_context
    assert 'chapter-number="{{ manuscript.chapterNumber|e }}"' in translation_context
    assert 'manuscript.actNumber is defined' not in translation_context
    assert 'manuscript.chapterNumber is defined' not in translation_context
    assert 'manuscript.actNumber is not none' in translation_context
    assert 'manuscript.chapterNumber is not none' in translation_context

    # translation referenceContext uses this variable
    assert 'act-number="{{ this.actNumber|e }}"' in translation_reference
    assert 'chapter-number="{{ this.chapterNumber|e }}"' in translation_reference
    assert 'this.actNumber is defined' not in translation_reference
    assert 'this.chapterNumber is defined' not in translation_reference
    assert 'this.actNumber is not none' in translation_reference
    assert 'this.chapterNumber is not none' in translation_reference

    assert "render_timeline_track_nodes" in common_context
    assert "render_timeline_events" in common_context
    assert "<timeline-track" in common_context
    assert "<timeline-event" in common_context
    assert "ctx.timelineTrackTree" in common_context
    assert "render_index_timeline_tracks" in common_index
    assert "render_index_timeline_events" in common_index
    assert "project.timeline.tracks" in common_index
    assert "project.timeline.events" in common_index


def test_default_translation_fragments_include_timeline_content_contract() -> None:
    document = _load_default_prompt_document()

    translation_context = document["fragments"]["translation"]["objectContext"]["content"]
    translation_reference = document["fragments"]["translation"]["referenceContext"]["content"]
    translation_tools = document["fragments"]["translation"]["tools"]["content"]
    translation_native = document["fragments"]["translation"]["nativeOutput"]["content"]
    translation_system = document["prompts"]["translation"]["object"]["system_template"]

    for fragment in (translation_context, translation_reference):
        assert "ctx.timelineTracks" in fragment
        assert "<timeline-tracks>" in fragment
        assert '<timeline-track id="{{ track.id|e }}" name="{{ track.name|e }}"' in fragment
        assert "<content>{{ track.content|e }}</content>" in fragment
        assert '<event id="{{ ev.id|e }}" track-id="{{ ev.trackId|e }}" track="{{ ev.trackName|e }}">' in fragment
        assert "<content>{{ ev.content|e }}</content>" in fragment
        assert "<tags>" in fragment
        assert "<tag>{{ tag|e }}</tag>" in fragment

    assert "`translate_timeline_track`" in translation_tools
    assert "`translate_timeline_event`" in translation_tools
    assert "`patch_translation_timeline_track`" in translation_tools
    assert "`patch_translation_timeline_event`" in translation_tools
    assert '"tool":"translate_timeline_track"' in translation_native
    assert '"tool":"translate_timeline_event"' in translation_native
    assert '"tool":"patch_translation_timeline_track"' in translation_native
    assert '"tool":"patch_translation_timeline_event"' in translation_native
    assert "timeline tracks/events" in translation_system
