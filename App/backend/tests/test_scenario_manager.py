from __future__ import annotations

from App.backend.services.prompt_runtime.scenario_manager import ScenarioManager


def test_image_prompt_data_populates_scene_chapter_from_manuscript_id() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={
            "promptMode": "natural",
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
        payload={"contextType": "scene", "manuscriptId": "missing"},
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


def test_image_prompt_data_prefers_selected_context_ids_and_exposes_legacy_alias() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={
            "selectedContextIds": ["context-1", "context-2"],
            "selectedEntityIds": ["legacy-1"],
        },
        project_data={},
        context_object_ids=["run-1"],
    )

    assert data["selectedContextIds"] == ["context-1", "context-2"]
    assert data["selectedEntityIds"] == ["context-1", "context-2"]


def test_image_prompt_data_uses_legacy_selected_entity_ids() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={"selectedEntityIds": ["legacy-1"]},
        project_data={},
        context_object_ids=["run-1"],
    )

    assert data["selectedContextIds"] == ["legacy-1"]
    assert data["selectedEntityIds"] == ["legacy-1"]


def test_image_prompt_data_falls_back_to_run_context_object_ids() -> None:
    data = ScenarioManager._build_image_prompt_data(
        payload={},
        project_data={},
        context_object_ids=["run-1", "run-2"],
    )

    assert data["selectedContextIds"] == ["run-1", "run-2"]
    assert data["selectedEntityIds"] == ["run-1", "run-2"]


def test_image_prompt_data_explicit_empty_selection_does_not_fall_back() -> None:
    for payload in (
        {"selectedContextIds": [], "selectedEntityIds": ["legacy-1"]},
        {"selectedEntityIds": []},
    ):
        data = ScenarioManager._build_image_prompt_data(
            payload=payload,
            project_data={},
            context_object_ids=["run-1"],
        )

        assert data["selectedContextIds"] == []
        assert data["selectedEntityIds"] == []
