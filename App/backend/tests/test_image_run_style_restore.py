from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base

fake_database = types.ModuleType("App.backend.database")
fake_database.Base = declarative_base()
fake_database.SessionLocal = lambda: None
sys.modules["App.backend.database"] = fake_database
sys.modules["database"] = fake_database

fake_deletion_service = types.ModuleType("App.backend.services.deletion_service")
fake_deletion_service.delete_assets_with_files = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.deletion_service"] = fake_deletion_service

fake_notification_service = types.ModuleType("App.backend.services.notification_service")
fake_notification_service.build_image_run_notification_snapshot = lambda *_args, **_kwargs: {}
fake_notification_service.build_agent_notification_snapshot = lambda **_kwargs: SimpleNamespace()
fake_notification_service.build_sub_agent_notification_snapshot = lambda **_kwargs: SimpleNamespace()
fake_notification_service.build_journey_notification_snapshot = lambda **_kwargs: SimpleNamespace()
fake_notification_service.serialize_notification = lambda *_args, **_kwargs: {}
fake_notification_service.upsert_notification_source = lambda *_args, **_kwargs: SimpleNamespace()
sys.modules["App.backend.services.notification_service"] = fake_notification_service

fake_object_change_events = types.ModuleType("App.backend.services.object_change_events")
fake_object_change_events.queue_object_change = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.object_change_events"] = fake_object_change_events

fake_object_service = types.ModuleType("App.backend.services.object_service")
fake_object_service.object_service = SimpleNamespace(get_object=lambda *_args, **_kwargs: None)
sys.modules["App.backend.services.object_service"] = fake_object_service

fake_rich_text = types.ModuleType("App.backend.services.rich_text")
fake_rich_text.tree_to_markdown = lambda *_args, **_kwargs: ""
sys.modules["App.backend.services.rich_text"] = fake_rich_text

fake_runtime_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
fake_runtime_dispatcher.runtime_event_dispatcher = SimpleNamespace(emit_project_event=lambda *_args, **_kwargs: None)
sys.modules["App.backend.services.runtime_event_dispatcher"] = fake_runtime_dispatcher

fake_settings_service = types.ModuleType("App.backend.services.settings_service")
fake_settings_service.settings_service = SimpleNamespace(_get_settings=lambda *_args, **_kwargs: SimpleNamespace(image_gen_config={}))
sys.modules["App.backend.services.settings_service"] = fake_settings_service

fake_storage_service = types.ModuleType("App.backend.services.storage_service")
fake_storage_service.storage_service = SimpleNamespace(
    save_generated_image=lambda **_kwargs: ("generated/test.png", "image/png", 1024, 1024, 2048),
    save_generated_image_from_url=lambda **_kwargs: ("generated/test.png", "image/png", 1024, 1024, 2048),
    build_public_asset_path=lambda path: str(path),
    read_asset_file=lambda *_args, **_kwargs: b"",
    to_png_bytes=lambda data: data,
    delete_asset_files=lambda *_args, **_kwargs: None,
)
sys.modules["App.backend.services.storage_service"] = fake_storage_service

fake_image_providers = types.ModuleType("App.backend.image_providers")
fake_image_providers.__path__ = []
fake_image_providers.gemini_image = SimpleNamespace()
fake_image_providers.novelai_image = SimpleNamespace()
fake_image_providers.openai_image = SimpleNamespace()
fake_image_providers.openrouter_image = SimpleNamespace()
fake_image_providers.xai_image = SimpleNamespace()
sys.modules["App.backend.image_providers"] = fake_image_providers

fake_image_providers_base = types.ModuleType("App.backend.image_providers.base")
fake_image_providers_base.BaseImageProvider = object
fake_image_providers_base.ImageGenerationResult = object
fake_image_providers_base.ReferenceImageData = object
sys.modules["App.backend.image_providers.base"] = fake_image_providers_base

fake_image_providers_registry = types.ModuleType("App.backend.image_providers.registry")
fake_image_providers_registry.ImageProviderRegistry = object
sys.modules["App.backend.image_providers.registry"] = fake_image_providers_registry

fake_thread_runtime_sync_service = types.ModuleType("App.backend.services.thread_runtime_sync_service")
fake_thread_runtime_sync_service.emit_runtime_sync_events = lambda *_args, **_kwargs: None
fake_thread_runtime_sync_service.sync_run_thread_status = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.thread_runtime_sync_service"] = fake_thread_runtime_sync_service

from App.backend.schemas.assets import CreateImageRunRequest
from App.backend.services import image_run_service as image_run_service_module


class FakeDB:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flush_calls = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flush_calls += 1


def test_create_direct_run_snapshot_preserves_style_id(monkeypatch) -> None:
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
                "prompt_type": "natural",
                "provider": "openai",
                "model": "gpt-image-1.5",
                "requested_aspect_ratio": "1:1",
                "requested_image_size": "1K",
                "style_id": "style-natural-1",
                "prompt": {"prefix": "cinematic ", "content": "castle", "postfix": " at night"},
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


def test_build_tool_recipe_snapshot_uses_selected_natural_style_id(monkeypatch) -> None:
    settings_row = SimpleNamespace(
        image_gen_config={
            "provider": "openai",
            "model": "gpt-image-1.5",
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
            "tagBasedStyles": [],
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

    monkeypatch.setattr(
        image_run_service_module,
        "_provider_template",
        lambda _provider_name: SimpleNamespace(get_prompt_type=lambda: "natural"),
    )

    snapshot = image_run_service_module._build_tool_recipe_snapshot(  # noqa: SLF001
        settings_row=settings_row,
        prompt_text="a hero portrait",
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
    assert snapshot["prompt"] == {
        "prefix": "painterly ",
        "content": "a hero portrait",
        "postfix": " --soft light",
    }


def test_build_tool_recipe_snapshot_uses_selected_tag_based_style_id(monkeypatch) -> None:
    settings_row = SimpleNamespace(
        image_gen_config={
            "provider": "novelai",
            "model": "nai-diffusion-4-5-full",
            "aspect_ratio": "1:1",
            "image_size": "1K",
            "selectedTagBasedStyleId": "style-tag-1",
            "naturalStyles": [],
            "tagBasedStyles": [
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

    monkeypatch.setattr(
        image_run_service_module,
        "_provider_template",
        lambda _provider_name: SimpleNamespace(get_prompt_type=lambda: "tag_based"),
    )

    snapshot = image_run_service_module._build_tool_recipe_snapshot(  # noqa: SLF001
        settings_row=settings_row,
        prompt_text="1girl",
        requested_aspect_ratio="1:1",
        requested_image_size="1K",
    )

    assert snapshot["style_id"] == "style-tag-1"
    assert snapshot["positive_prompt"] == {
        "prefix": "masterpiece, ",
        "content": "1girl",
        "postfix": ", detailed eyes",
    }
    assert snapshot["negative_prompt"] == {
        "prefix": "lowres, ",
        "content": "",
        "postfix": ", blurry",
    }


def test_create_asset_for_run_persists_generation_style_id(monkeypatch) -> None:
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
            "provider": "openai",
            "model": "gpt-image-2",
            "style_id": "style-natural-1",
            "requested_aspect_ratio": "16:9",
            "requested_image_size": "4K",
            "prompt": {"prefix": "cinematic ", "content": "castle", "postfix": " at night"},
            "provider_settings": {"quality": "high"},
        },
        result=result,
        is_preview=False,
    )

    assert asset.generation_style_id == "style-natural-1"
    assert asset.generation_requested_aspect_ratio == "16:9"
    assert asset.generation_requested_image_size == "4K"
    assert db.added[-1] is asset
