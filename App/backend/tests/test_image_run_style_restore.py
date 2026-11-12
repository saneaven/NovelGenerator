from __future__ import annotations

import asyncio
import importlib
import sys
import types
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import declarative_base

from App.backend.schemas.assets import CreateImageRunRequest


class FakeDB:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flush_calls = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flush_calls += 1


def load_image_run_service(monkeypatch):
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    monkeypatch.setitem(sys.modules, "App.backend.database", fake_database)
    monkeypatch.setitem(sys.modules, "database", fake_database)

    fake_deletion_service = types.ModuleType("App.backend.services.deletion_service")
    fake_deletion_service.delete_assets_with_files = lambda *_args, **_kwargs: None
    monkeypatch.setitem(sys.modules, "App.backend.services.deletion_service", fake_deletion_service)

    fake_notification_service = types.ModuleType("App.backend.services.notification_service")
    fake_notification_service.build_image_run_notification_snapshot = lambda *_args, **_kwargs: {}
    fake_notification_service.build_agent_notification_snapshot = lambda **_kwargs: SimpleNamespace()
    fake_notification_service.build_sub_agent_notification_snapshot = lambda **_kwargs: SimpleNamespace()
    fake_notification_service.build_journey_notification_snapshot = lambda **_kwargs: SimpleNamespace()
    fake_notification_service.serialize_notification = lambda *_args, **_kwargs: {}
    fake_notification_service.upsert_notification_source = lambda *_args, **_kwargs: SimpleNamespace()
    monkeypatch.setitem(sys.modules, "App.backend.services.notification_service", fake_notification_service)

    fake_object_change_events = types.ModuleType("App.backend.services.object_change_events")
    fake_object_change_events.queue_object_change = lambda *_args, **_kwargs: None
    monkeypatch.setitem(sys.modules, "App.backend.services.object_change_events", fake_object_change_events)

    fake_object_service = types.ModuleType("App.backend.services.object_service")
    fake_object_service.object_service = SimpleNamespace(get_object=lambda *_args, **_kwargs: None)
    monkeypatch.setitem(sys.modules, "App.backend.services.object_service", fake_object_service)

    fake_rich_text = types.ModuleType("App.backend.services.rich_text")
    fake_rich_text.get_rich_text_fields = lambda *_args, **_kwargs: ()
    fake_rich_text.normalize_tree = lambda value, *_args, **_kwargs: value
    fake_rich_text.render_markdown_image = lambda *_args, **_kwargs: ""
    fake_rich_text.tree_to_markdown = lambda *_args, **_kwargs: ""
    monkeypatch.setitem(sys.modules, "App.backend.services.rich_text", fake_rich_text)

    fake_runtime_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
    fake_runtime_dispatcher.runtime_event_dispatcher = SimpleNamespace(
        emit_project_event=lambda *_args, **_kwargs: None,
        emit_runtime_event=lambda *_args, **_kwargs: None,
    )
    monkeypatch.setitem(sys.modules, "App.backend.services.runtime_event_dispatcher", fake_runtime_dispatcher)

    fake_settings_service = types.ModuleType("App.backend.services.settings_service")
    fake_settings_service.settings_service = SimpleNamespace(_get_settings=lambda *_args, **_kwargs: SimpleNamespace(image_gen_config={}))
    monkeypatch.setitem(sys.modules, "App.backend.services.settings_service", fake_settings_service)

    fake_storage_service = types.ModuleType("App.backend.services.storage_service")
    fake_storage_service.storage_service = SimpleNamespace(
        save_generated_image=lambda **_kwargs: ("generated/test.png", "image/png", 1024, 1024, 2048),
        save_generated_image_from_url=lambda **_kwargs: ("generated/test.png", "image/png", 1024, 1024, 2048),
        build_public_asset_path=lambda path: str(path),
        read_asset_file=lambda *_args, **_kwargs: b"",
        to_png_bytes=lambda data: data,
        delete_asset_files=lambda *_args, **_kwargs: None,
    )
    monkeypatch.setitem(sys.modules, "App.backend.services.storage_service", fake_storage_service)

    fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")

    class _StorageQuotaExceededError(Exception):
        pass

    fake_storage_usage_service.StorageQuotaExceededError = _StorageQuotaExceededError
    fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_asset_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_asset_rows_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_image_run_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_asset_row = lambda asset: {"id": str(getattr(asset, "id", ""))}
    fake_storage_usage_service.snapshot_image_run_row = lambda row: {"id": str(getattr(row, "id", ""))}
    fake_storage_usage_service.snapshot_rows = lambda rows, fn: [fn(row) for row in rows]
    fake_storage_usage_service.snapshot_tool_call_row = lambda row: {"id": str(getattr(row, "id", ""))}
    monkeypatch.setitem(sys.modules, "App.backend.services.storage_usage_service", fake_storage_usage_service)

    fake_thread_runtime_sync_service = types.ModuleType("App.backend.services.thread_runtime_sync_service")
    fake_thread_runtime_sync_service.emit_runtime_sync_events = lambda *_args, **_kwargs: None
    fake_thread_runtime_sync_service.sync_run_thread_status = lambda *_args, **_kwargs: None
    monkeypatch.setitem(sys.modules, "App.backend.services.thread_runtime_sync_service", fake_thread_runtime_sync_service)

    sys.modules.pop("App.backend.services.image_run_service", None)
    return importlib.import_module("App.backend.services.image_run_service")


@pytest.mark.parametrize("content_language", ["Korean", "English"])
def test_markdown_for_manuscript_reads_projected_content_tree(monkeypatch, content_language: str) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    db = FakeDB()
    project_id = uuid4()
    manuscript_id = uuid4()
    content_tree = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "The gate opened."}],
            }
        ],
    }
    projected_manuscript = {
        "id": str(manuscript_id),
        "type": "manuscript",
        "data": {"content": content_tree, "wordCount": 3},
        "language_state": {
            "requested_language": "Korean",
            "content_language": content_language,
            "is_fallback": content_language != "Korean",
        },
    }

    def get_object(received_db, **kwargs):
        assert received_db is db
        assert kwargs == {
            "object_type": "manuscript",
            "object_id": manuscript_id,
            "project_id": project_id,
            "language": "Korean",
            "rich_text_format": "tree",
        }
        return projected_manuscript

    def tree_to_markdown(tree, *, image_titles_by_asset_id):
        assert tree is content_tree
        assert image_titles_by_asset_id == {"asset-1": "Gate illustration"}
        return "The gate opened."

    def build_asset_title_map(received_db, **kwargs):
        assert received_db is db
        assert kwargs == {"project_id": project_id, "trees": [content_tree]}
        return {"asset-1": "Gate illustration"}

    monkeypatch.setattr(image_run_service_module.object_service, "get_object", get_object)
    monkeypatch.setattr(image_run_service_module, "tree_to_markdown", tree_to_markdown)
    monkeypatch.setattr(image_run_service_module, "build_asset_title_map", build_asset_title_map)

    markdown = asyncio.run(
        image_run_service_module.markdown_for_manuscript(
            db,
            project_id=project_id,
            manuscript_id=manuscript_id,
            language="Korean",
        )
    )

    assert markdown == "The gate opened."


@pytest.mark.parametrize("data", [None, {}, {"content": "Missing tree"}])
def test_markdown_for_manuscript_rejects_missing_projected_content_tree(monkeypatch, data) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    monkeypatch.setattr(
        image_run_service_module.object_service,
        "get_object",
        lambda *_args, **_kwargs: {"data": data},
    )

    with pytest.raises(ValueError, match="^MANUSCRIPT_EMPTY$"):
        asyncio.run(
            image_run_service_module.markdown_for_manuscript(
                FakeDB(),
                project_id=uuid4(),
                manuscript_id=uuid4(),
                language="Korean",
            )
        )


def test_validate_scene_anchor_accepts_projected_manuscript_content(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    content_tree = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Before. The gate opened. After."}],
            }
        ],
    }
    monkeypatch.setattr(
        image_run_service_module.object_service,
        "get_object",
        lambda *_args, **_kwargs: {"data": {"content": content_tree, "wordCount": 6}},
    )
    monkeypatch.setattr(image_run_service_module, "build_asset_title_map", lambda *_args, **_kwargs: {})

    def tree_to_markdown(tree, **_kwargs):
        assert tree is content_tree
        return "Before. The gate opened. After."

    monkeypatch.setattr(image_run_service_module, "tree_to_markdown", tree_to_markdown)

    excerpts = asyncio.run(
        image_run_service_module.validate_scene_anchor(
            FakeDB(),
            project_id=uuid4(),
            manuscript_id=uuid4(),
            language="Korean",
            anchor={"before": "Before.", "after": "The gate opened."},
        )
    )

    assert excerpts == ("Before.", "The gate opened. After.")


@pytest.mark.parametrize(
    "anchor",
    [
        None,
        "The gate opened.",
        [],
        {},
        {"before": "The gate opened."},
        {"after": "They stepped inside."},
        {"before": "", "after": "They stepped inside."},
        {"before": " \n ", "after": "They stepped inside."},
        {"before": "The gate opened.", "after": ""},
        {"before": "The gate opened.", "after": 1},
        {"before": "The gate opened.", "after": "They stepped inside.", "extra": "nope"},
    ],
)
def test_normalize_scene_anchor_requires_both_nonblank_contexts(monkeypatch, anchor) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)

    with pytest.raises(ValueError):
        image_run_service_module.normalize_scene_anchor(anchor)


def test_normalize_scene_anchor_preserves_exact_text_whitespace(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    anchor = {"before": "  The gate opened.\n", "after": "\nThey stepped inside.  "}

    assert image_run_service_module.normalize_scene_anchor(anchor) == anchor


@pytest.mark.parametrize(
    "markdown",
    [
        "The gate closed. They stepped inside.",
        "The gate opened. They stayed outside.",
        "They stepped inside. The gate opened.",
        "The gate opened. A guard stopped them. They stepped inside.",
        "The gate opened. They stepped inside. The gate opened. They stepped inside.",
    ],
)
def test_resolve_scene_anchor_rejects_missing_nonadjacent_or_ambiguous_pair(monkeypatch, markdown: str) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)

    with pytest.raises(ValueError):
        image_run_service_module.resolve_scene_anchor(
            markdown, {"before": "The gate opened.", "after": "They stepped inside."},
        )


@pytest.mark.parametrize("gap", ["", " ", "\n\n", "\t \n"])
def test_resolve_scene_anchor_accepts_whitespace_gap_and_returns_after_start(monkeypatch, gap: str) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    markdown = f"Intro. The gate opened.{gap}They stepped inside. End."

    index = image_run_service_module.resolve_scene_anchor(
        markdown, {"before": "The gate opened.", "after": "They stepped inside."},
    )

    assert index == markdown.index("They stepped inside.")


def test_resolve_scene_anchor_allows_repeated_individual_contexts_when_pair_is_unique(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    markdown = "Before. Other. After.\nBefore.\n\nAfter.\nBefore. Other. After."

    index = image_run_service_module.resolve_scene_anchor(markdown, {"before": "Before.", "after": "After."})

    assert index == markdown.index("\n\nAfter.") + 2


@pytest.mark.parametrize("name_field", ["name", "title"])
def test_object_display_name_reads_projected_payload(monkeypatch, name_field: str) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    obj = {"data": {name_field: "  The North Gate  ", "content": {"type": "doc", "content": []}}}

    assert image_run_service_module._object_display_name(obj, "Korean", fallback="Scene") == "The North Gate"


def test_create_direct_run_snapshot_preserves_style_id(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    service = image_run_service_module.ImageRunService(lambda: None)
    db = FakeDB()
    project_id = uuid4()
    user_id = uuid4()

    monkeypatch.setattr(service, "_validate_direct_target", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "apply_project_usage_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "build_image_run_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "snapshot_image_run_row", lambda row: {"id": str(row.id)})

    request = CreateImageRunRequest.model_validate(
        {
            "client_request_id": "req-1",
            "recipe": {
                "prompt_format": "natural",
                "prompt_data": {
                    "prompt": {
                        "prefix": "cinematic ",
                        "content": "castle",
                        "postfix": " at night",
                    },
                },
                "provider": "openai",
                "model": "gpt-image-2",
                "requested_aspect_ratio": "1:1",
                "requested_image_size": "1K",
                "style_id": "style-natural-1",
            },
            "target": {
                "type": "object",
                "object_type": "character",
                "object_id": str(uuid4()),
            },
        }
    )

    row = service.create_direct_run(db, project_id=project_id, user_id=user_id, request=request)

    assert row.request_snapshot["recipe"]["style_id"] == "style-natural-1"
    assert row.request_snapshot["recipe"]["model"] == "gpt-image-2"


def test_create_direct_run_snapshot_preserves_novelai_character_pairs(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    service = image_run_service_module.ImageRunService(lambda: None)
    db = FakeDB()
    monkeypatch.setattr(service, "_validate_direct_target", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "apply_project_usage_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "build_image_run_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "snapshot_image_run_row", lambda row: {"id": str(row.id)})
    characters = [
        {"positive": "girl, red hair", "negative": "blue hair"},
        {"positive": "boy, blue coat", "negative": "red coat"},
    ]
    request = CreateImageRunRequest.model_validate(
        {
            "recipe": {
                "prompt_format": "novelai",
                "prompt_data": {
                    "positive": {"content": "1girl, 1boy, rooftop"},
                    "negative": {"content": "lowres"},
                    "characters": characters,
                },
                "provider": "novelai",
                "model": "nai-diffusion-5-curated",
                "requested_aspect_ratio": "13:19",
                "requested_image_size": "832x1216",
            },
            "target": {
                "type": "object",
                "object_type": "story_entity",
                "object_id": str(uuid4()),
            },
        }
    )

    row = service.create_direct_run(
        db,
        project_id=uuid4(),
        user_id=uuid4(),
        request=request,
    )

    assert row.request_snapshot["recipe"]["prompt_format"] == "novelai"
    assert row.request_snapshot["recipe"]["prompt_data"]["characters"] == characters


def test_build_tool_recipe_snapshot_uses_selected_natural_style_id(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    settings_row = SimpleNamespace(
        image_gen_config={
            "provider": "openai",
            "model": "gpt-image-2",
            "aspect_ratio": "1:1",
            "image_size": "1K",
            "selectedNaturalStyleId": "style-natural-1",
            "naturalStyles": [
                {
                    "id": "style-natural-1",
                    "name": "Painterly",
                    "prefix": "painterly ",
                    "postfix": " --soft light",
                }
            ],
            "positiveNegativeStyles": [],
            "novelAIStyles": [],
            "providerSettings": {
                "openai": {
                    "quality": "high",
                    "background": "transparent",
                    "output_format": "png",
                    "output_compression": 90,
                },
                "novelai": {
                    "sampler": "k_euler_ancestral",
                    "steps": 28,
                    "scale": 6.0,
                    "noise_schedule": "karras",
                },
            },
        }
    )

    snapshot = image_run_service_module._build_tool_recipe_snapshot(  # noqa: SLF001
        settings_row=settings_row,
        prompt_data={"prompt": "a hero portrait"},
        requested_aspect_ratio="3:2",
        requested_image_size="1K",
    )

    assert snapshot["style_id"] == "style-natural-1"
    assert snapshot["model"] == "gpt-image-2"
    assert snapshot["provider_settings"] == {
        "quality": "high",
        "background": "auto",
        "output_format": "png",
        "output_compression": 90,
        "moderation": "auto",
    }
    assert snapshot["prompt_format"] == "natural"
    assert snapshot["prompt_data"]["prompt"] == {
        "prefix": "painterly ",
        "content": "a hero portrait",
        "postfix": " --soft light",
    }


def test_build_tool_recipe_snapshot_supports_positive_negative_style(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    monkeypatch.setattr(
        image_run_service_module,
        "resolve_prompt_format",
        lambda *_args, **_kwargs: "positive_negative",
    )
    settings_row = SimpleNamespace(
        image_gen_config={
            "provider": "openai",
            "model": "future-positive-negative-model",
            "aspect_ratio": "1:1",
            "image_size": "1K",
            "naturalStyles": [],
            "positiveNegativeStyles": [
                {
                    "id": "style-pn-1",
                    "name": "Photo",
                    "positivePrefix": "photo of ",
                    "positivePostfix": ", sharp",
                    "negativePrefix": "avoid ",
                    "negativePostfix": ", artifacts",
                }
            ],
            "novelAIStyles": [],
            "selectedPositiveNegativeStyleId": "style-pn-1",
            "providerSettings": {"openai": {}},
        }
    )

    snapshot = image_run_service_module._build_tool_recipe_snapshot(  # noqa: SLF001
        settings_row=settings_row,
        prompt_data={"positive": "a castle", "negative": "blurry"},
        requested_aspect_ratio="1:1",
        requested_image_size="1K",
    )

    assert snapshot["prompt_format"] == "positive_negative"
    assert snapshot["prompt_data"] == {
        "positive": {
            "prefix": "photo of ",
            "content": "a castle",
            "postfix": ", sharp",
        },
        "negative": {
            "prefix": "avoid ",
            "content": "blurry",
            "postfix": ", artifacts",
        },
    }


def test_build_tool_recipe_snapshot_uses_selected_novelai_style_id(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    settings_row = SimpleNamespace(
        image_gen_config={
            "provider": "novelai",
            "model": "nai-diffusion-4-5-full",
            "aspect_ratio": "1:1",
            "image_size": "1K",
            "selectedNovelAIStyleId": "style-tag-1",
            "naturalStyles": [],
            "positiveNegativeStyles": [],
            "novelAIStyles": [
                {
                    "id": "style-tag-1",
                    "name": "Anime",
                    "positivePrefix": "masterpiece, ",
                    "positivePostfix": ", detailed eyes",
                    "negativePrefix": "lowres, ",
                    "negativePostfix": ", blurry",
                }
            ],
            "providerSettings": {
                "openai": {
                    "quality": "auto",
                    "background": "auto",
                    "output_format": "png",
                    "output_compression": 90,
                },
                "novelai": {
                    "sampler": "k_euler_ancestral",
                    "steps": 28,
                    "scale": 6.0,
                    "noise_schedule": "karras",
                },
            },
        }
    )

    snapshot = image_run_service_module._build_tool_recipe_snapshot(  # noqa: SLF001
        settings_row=settings_row,
        prompt_data={
            "positive": "1girl",
            "negative": "bad hands",
            "characters": [
                {"positive": "red-haired heroine", "negative": "blurry face"},
                {"positive": "blue-coated hero", "negative": "bad anatomy"},
            ],
        },
        requested_aspect_ratio="1:1",
        requested_image_size="1K",
    )

    assert snapshot["style_id"] == "style-tag-1"
    assert snapshot["prompt_format"] == "novelai"
    assert snapshot["prompt_data"]["positive"] == {
        "prefix": "masterpiece, ",
        "content": "1girl",
        "postfix": ", detailed eyes",
    }
    assert snapshot["prompt_data"]["negative"] == {
        "prefix": "lowres, ",
        "content": "bad hands",
        "postfix": ", blurry",
    }
    assert snapshot["prompt_data"]["characters"] == [
        {"positive": "red-haired heroine", "negative": "blurry face"},
        {"positive": "blue-coated hero", "negative": "bad anatomy"},
    ]


@pytest.mark.parametrize("target_kind", ["object", "scene"])
def test_create_tool_preview_run_preserves_novelai_characters_for_both_image_tools(
    monkeypatch,
    target_kind: str,
) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    service = image_run_service_module.ImageRunService(lambda: None)
    db = FakeDB()
    project_id = uuid4()
    object_id = uuid4()
    manuscript_id = uuid4()
    arguments = {
        "positive": "two heroes",
        "negative": "lowres",
        "characters": [
            {"positive": "red-haired heroine", "negative": "blurry face"},
            {"positive": "blue-coated hero", "negative": "bad anatomy"},
        ],
        "ratio": "1:1",
    }
    if target_kind == "object":
        arguments["object_id"] = str(object_id)
        tool_name = image_run_service_module.IMAGE_OBJECT_TOOL
    else:
        arguments["manuscript_id"] = str(manuscript_id)
        arguments["anchor"] = {"before": "The gate opened.", "after": "They stepped inside."}
        tool_name = image_run_service_module.IMAGE_SCENE_TOOL
    tool_call = SimpleNamespace(
        id=uuid4(),
        thread_id=uuid4(),
        tool_name=tool_name,
        arguments=arguments,
        run=SimpleNamespace(
            input_payload={},
            project_id=project_id,
        ),
        thread=SimpleNamespace(project_id=project_id),
        image_run_id=None,
        updated_at=None,
    )
    settings_row = SimpleNamespace(
        image_gen_config={
            "provider": "novelai",
            "model": "nai-diffusion-4-5-full",
            "aspect_ratio": "1:1",
            "image_size": "1K",
            "naturalStyles": [],
            "positiveNegativeStyles": [],
            "novelAIStyles": [],
            "providerSettings": {"novelai": {}},
        }
    )
    monkeypatch.setattr(
        image_run_service_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: settings_row,
    )
    monkeypatch.setattr(
        image_run_service_module,
        "resolve_explicit_object_target",
        lambda *_args, **_kwargs: ("character", object_id),
    )
    async def _validate_scene(*_args, **_kwargs):
        return "before", "after"

    monkeypatch.setattr(image_run_service_module, "validate_scene_anchor", _validate_scene)
    monkeypatch.setattr(
        image_run_service_module,
        "apply_project_usage_delta",
        lambda *_args, **_kwargs: None,
    )

    row = asyncio.run(
        service.create_tool_preview_run(
            db,
            tool_call=tool_call,
            user_id=uuid4(),
            language="English",
        )
    )

    recipe = row.request_snapshot["recipe"]
    assert recipe["prompt_format"] == "novelai"
    assert recipe["prompt_data"]["positive"]["content"] == "two heroes"
    assert recipe["prompt_data"]["negative"]["content"] == "lowres"
    assert recipe["prompt_data"]["characters"] == [
        {"positive": "red-haired heroine", "negative": "blurry face"},
        {"positive": "blue-coated hero", "negative": "bad anatomy"},
    ]
    assert row.request_snapshot["target"]["type"] == target_kind
    if target_kind == "scene":
        assert row.request_snapshot["target"]["anchor"] == arguments["anchor"]
        assert "insert_before" not in row.request_snapshot["target"]
        assert row.request_snapshot["apply_kind"] == "insert_scene_at_anchor"


@pytest.mark.parametrize("change", [None, "before", "after", "gap"])
def test_apply_scene_image_revalidates_and_inserts_between_both_contexts(monkeypatch, change: str | None) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    service = image_run_service_module.ImageRunService(lambda: None)
    manuscript_id = uuid4()
    anchor = {"before": "The gate opened.", "after": "They stepped inside."}
    markdown = f"Intro.\n\n{anchor['before']}\n\n{anchor['after']}\n\nEnd."
    image_markdown = "![Gate](generated/test.png)"
    asset = SimpleNamespace(
        id=uuid4(),
        file_path="generated/test.png",
        name="Gate",
        preview_image_run_id=uuid4(),
        manuscript_id=None,
        updated_at=None,
    )
    target = {"type": "scene", "manuscript_id": str(manuscript_id), "anchor": anchor}
    row = SimpleNamespace(
        project_id=uuid4(),
        user_id=uuid4(),
        preview_asset_id=asset.id,
        final_asset_id=None,
        request_snapshot={"target": target, "apply_kind": "insert_scene_at_anchor"},
    )

    class Query:
        def filter(self, *_args):
            return self

        def first(self):
            return asset

    db = SimpleNamespace(query=lambda *_args: Query())
    updates = []

    async def manuscript_markdown(*_args, **_kwargs):
        if change in {"before", "after"}:
            return markdown.replace(anchor[change], "The story changed.")
        if change == "gap":
            return markdown.replace(anchor["after"], f"A guard stopped them.\n\n{anchor['after']}")
        return markdown

    monkeypatch.setattr(image_run_service_module, "markdown_for_manuscript", manuscript_markdown)
    monkeypatch.setattr(image_run_service_module, "render_markdown_image", lambda *_args, **_kwargs: image_markdown)
    monkeypatch.setattr(
        image_run_service_module.object_service,
        "update_object",
        lambda received_db, **kwargs: updates.append((received_db, kwargs)),
        raising=False,
    )
    monkeypatch.setattr(image_run_service_module, "queue_project_assets_change", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "queue_scene_assets_change", lambda *_args, **_kwargs: None)

    if change is not None:
        with pytest.raises(ValueError):
            asyncio.run(service._apply_asset_for_run(db=db, row=row, user_id=row.user_id, language="Korean"))
        assert updates == []
        assert asset.manuscript_id is None
        assert asset.preview_image_run_id is not None
        assert row.final_asset_id is None
        return

    asyncio.run(service._apply_asset_for_run(db=db, row=row, user_id=row.user_id, language="Korean"))

    expected_content = f"Intro.\n\n{anchor['before']}\n\n{image_markdown}\n\n{anchor['after']}\n\nEnd."
    assert len(updates) == 1
    assert updates[0] == (db, {
        "project_id": row.project_id,
        "object_type": "manuscript",
        "object_id": manuscript_id,
        "data": {"content": expected_content},
        "language": "Korean",
        "rich_text_format": "markdown",
        "user_request": "tool:generate_scene_image",
        "created_by": row.user_id,
        "create_new_version": True,
    })
    assert asset.manuscript_id == manuscript_id
    assert asset.preview_image_run_id is None
    assert row.final_asset_id == asset.id


def test_create_asset_for_run_persists_generation_style_id(monkeypatch) -> None:
    image_run_service_module = load_image_run_service(monkeypatch)
    service = image_run_service_module.ImageRunService(lambda: None)
    db = FakeDB()
    row = SimpleNamespace(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        request_snapshot={"target": {"type": "object"}},
    )
    result = SimpleNamespace(
        image_b64="ZmFrZS1pbWFnZQ==",
        image_data=None,
        format="png",
        width=1024,
        height=1024,
    )

    monkeypatch.setattr(
        image_run_service_module.storage_service,
        "save_generated_image",
        lambda **_kwargs: ("generated/test.png", "image/png", 1024, 1024, 2048),
    )
    monkeypatch.setattr(image_run_service_module, "apply_project_usage_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "build_asset_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_run_service_module, "snapshot_asset_row", lambda asset: {"id": str(asset.id)})

    asset = service._create_asset_for_run(  # noqa: SLF001
        db=db,
        row=row,
        recipe={
            "prompt_format": "natural",
            "prompt_data": {
                "prompt": {
                    "prefix": "cinematic ",
                    "content": "castle",
                    "postfix": " at night",
                },
            },
            "provider": "openai",
            "model": "gpt-image-2",
            "style_id": "style-natural-1",
            "requested_aspect_ratio": "16:9",
            "requested_image_size": "4K",
            "provider_settings": {"quality": "high"},
        },
        result=result,
        is_preview=False,
    )

    assert asset.generation_style_id == "style-natural-1"
    assert asset.generation_prompt_format == "natural"
    assert asset.generation_prompt_data == {
        "prompt": {
            "prefix": "cinematic ",
            "content": "castle",
            "postfix": " at night",
        },
    }
    assert asset.generation_requested_aspect_ratio == "16:9"
    assert asset.generation_requested_image_size == "4K"
    assert db.added[-1] is asset
