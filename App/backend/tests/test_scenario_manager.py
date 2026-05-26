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
    )

    assert data["sceneChapter"] == {
        "manuscriptId": "",
        "chapterId": "",
        "chapterName": "",
        "actNumber": None,
        "chapterNumber": None,
    }
