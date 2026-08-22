from __future__ import annotations

from types import SimpleNamespace

import pytest

from App.backend.services.prompt_runtime import scenario_manager as scenario_manager_module
from App.backend.services.prompt_runtime.scenario_manager import ScenarioManager


def _patch_template_data_dependencies(monkeypatch, *, journey_kind: str | None = None) -> None:
    monkeypatch.setattr(
        scenario_manager_module,
        "resolve_parent",
        lambda _db, _thread: SimpleNamespace(
            journey_kind=journey_kind,
            sub_agent_definition=None,
        ),
    )
    monkeypatch.setattr(
        scenario_manager_module.settings_service,
        "get_task_config",
        lambda *_args, **_kwargs: SimpleNamespace(advanced={}),
    )
    monkeypatch.setattr(
        scenario_manager_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: SimpleNamespace(native_output_mode=False),
    )
    monkeypatch.setattr(
        scenario_manager_module.variable_service,
        "get_variables_for_template",
        lambda *_args, **_kwargs: {},
    )


@pytest.mark.parametrize("task_type", ["agent", "subAgent", "editAssistant", "translation"])
def test_non_image_tasks_do_not_require_image_prompt_format(monkeypatch, task_type: str) -> None:
    _patch_template_data_dependencies(monkeypatch)

    data = ScenarioManager().build_template_data(
        None,
        user_id="user-id",
        preset_id="preset-id",
        task_type=task_type,
        thread=SimpleNamespace(),
        run=SimpleNamespace(
            language="English",
            context_object_ids=[],
            journey_target_ids=[],
            run_mode="agentMode",
            surface="story-entity",
        ),
        project_data={},
        input_text="Continue the story",
        input_payload={},
    )

    assert data["imagePrompt"] == {}


def test_image_prompt_task_still_requires_prompt_format(monkeypatch) -> None:
    _patch_template_data_dependencies(monkeypatch, journey_kind="imagePrompt")

    with pytest.raises(ValueError, match="require a valid promptFormat"):
        ScenarioManager().build_template_data(
            None,
            user_id="user-id",
            preset_id="preset-id",
            task_type="imagePrompt",
            thread=SimpleNamespace(),
            run=SimpleNamespace(
                language="English",
                context_object_ids=[],
                journey_target_ids=[],
                run_mode="agentMode",
                surface="story-entity",
            ),
            project_data={},
            input_text="Create an image prompt",
            input_payload={},
        )


@pytest.mark.parametrize(
    ("journey_kind", "expected_subtype"),
    [
        ("imagePrompt", "object"),
        ("sceneImagePrompt", "scene"),
    ],
)
def test_image_prompt_target_subtype_comes_from_journey_kind(
    monkeypatch,
    journey_kind: str,
    expected_subtype: str,
) -> None:
    monkeypatch.setattr(
        scenario_manager_module,
        "resolve_parent",
        lambda _db, _thread: SimpleNamespace(journey_kind=journey_kind),
    )

    target = ScenarioManager().resolve_target(
        None,
        thread=SimpleNamespace(thread_type="journey"),
        run=SimpleNamespace(),
        payload={},
    )

    assert target.task_type == "imagePrompt"
    assert target.task_subtype == expected_subtype


def test_image_prompt_data_populates_scene_chapter_from_manuscript_id() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={
            "promptFormat": "natural",
            "contextType": "scene",
            "manuscriptId": "ms-2",
            "sceneContext": {"preContext": "Before", "postContext": "After"},
        },
        context_object_ids=[],
        project_data={
            "manuscripts": [
                {
                    "id": "ms-1",
                    "chapterId": "chapter-1",
                    "chapterName": "Opening",
                    "actNumber": 1,
                    "chapterNumber": 1,
                },
                {
                    "id": "ms-2",
                    "chapterId": "chapter-2",
                    "chapterName": "The Raid",
                    "actNumber": 2,
                    "chapterNumber": 7,
                },
            ],
        },
    )

    assert data["sceneChapter"] == {
        "manuscriptId": "ms-2",
        "chapterId": "chapter-2",
        "chapterName": "The Raid",
        "actNumber": 2,
        "chapterNumber": 7,
    }
    assert data["scenePreContext"] == "Before"
    assert data["scenePostContext"] == "After"


def test_image_prompt_data_uses_empty_scene_chapter_when_manuscript_missing() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={"promptFormat": "natural", "contextType": "scene", "manuscriptId": "missing"},
        project_data={"manuscripts": []},
        context_object_ids=[],
    )

    assert data["sceneChapter"] == {
        "manuscriptId": "",
        "chapterId": "",
        "chapterName": "",
        "actNumber": None,
        "chapterNumber": None,
    }


def test_image_prompt_data_prefers_selected_context_ids() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={
            "promptFormat": "novelai",
            "selectedContextIds": ["context-1", "context-2"],
        },
        project_data={},
        context_object_ids=["run-1"],
    )

    assert data["selectedContextIds"] == ["context-1", "context-2"]
    assert data["promptFormat"] == "novelai"


def test_image_prompt_data_falls_back_to_run_context_object_ids() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={"promptFormat": "positive_negative"},
        project_data={},
        context_object_ids=["run-1", "run-2"],
    )

    assert data["selectedContextIds"] == ["run-1", "run-2"]


def test_image_prompt_data_explicit_empty_selection_does_not_fall_back() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={"promptFormat": "natural", "selectedContextIds": []},
        project_data={},
        context_object_ids=["run-1"],
    )

    assert data["selectedContextIds"] == []


def test_image_prompt_data_exposes_nested_saved_prompts() -> None:
    prompts = {
        "natural": {"prompt": "portrait"},
        "positive_negative": {"positive": "portrait", "negative": "blur"},
        "novelai": {
            "positive": "1girl, portrait",
            "negative": "blur",
            "characters": [{"positive": "girl, red hair", "negative": "blue hair"}],
        },
    }
    data = ScenarioManager._build_image_prompt_data(
        payload={"promptFormat": "novelai", "objectId": "entity-1", "objectType": "story_entity"},
        project_data={
            "storyEntities": [
                {
                    "id": "entity-1",
                    "kind": "character",
                    "name": "Ari",
                    "imagePrompts": prompts,
                }
            ]
        },
        context_object_ids=[],
    )

    assert data["currentTarget"]["storyEntity"]["imagePrompts"] == prompts
