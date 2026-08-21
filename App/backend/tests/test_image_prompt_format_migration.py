from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Any


def test_image_prompt_format_migration_moves_prompts_runs_assets_and_styles(monkeypatch) -> None:
    migration = importlib.import_module(
        "App.backend.alembic.versions.0026_image_prompt_formats"
    )
    added: list[tuple[str, str]] = []
    dropped: list[tuple[str, str]] = []
    altered: list[tuple[str, str, dict[str, Any]]] = []
    statements: list[Any] = []

    monkeypatch.setattr(
        migration.op,
        "add_column",
        lambda table, column: added.append((table, column.name)),
    )
    monkeypatch.setattr(
        migration.op,
        "drop_column",
        lambda table, column: dropped.append((table, column)),
    )
    monkeypatch.setattr(
        migration.op,
        "alter_column",
        lambda table, column, **kwargs: altered.append((table, column, kwargs)),
    )
    monkeypatch.setattr(
        migration.op,
        "execute",
        lambda statement: statements.append(statement),
    )

    migration.upgrade()

    assert ("basic_info", "image_prompts") in added
    assert ("story_entities", "image_prompts") in added
    assert ("assets", "generation_prompt_format") in added
    assert ("assets", "generation_prompt_data") in added
    assert ("basic_info", "image_prompt") in dropped
    assert ("story_entities", "image_prompt_positive") in dropped
    assert ("assets", "generation_negative_prompt") in dropped
    assert {table for table, column, _ in altered if column == "image_prompts"} == {
        "basic_info",
        "story_entities",
    }
    assert any(
        table == "user_settings"
        and column == "image_gen_config"
        and kwargs.get("server_default") is migration.NEW_IMAGE_GEN_CONFIG_DEFAULT
        for table, column, kwargs in altered
    )

    sql = "\n".join(str(statement) for statement in statements)
    assert "'positive_negative'" in sql
    assert "'novelai'" in sql
    assert sql.count("COALESCE(image_prompt_positive, '')") == 4
    assert sql.count("COALESCE(image_prompt_negative, '')") == 4
    assert "'characters', '[]'::jsonb" in sql
    assert "UPDATE image_runs" in sql
    assert "'prompt_format'" in sql
    assert "'prompt_data'" in sql
    assert "'positiveNegativeStyles', '[]'::jsonb" in sql
    assert "'novelAIStyles', COALESCE(NULLIF(image_gen_config->'tagBasedStyles'" in sql
    assert "'selectedNovelAIStyleId', image_gen_config->'selectedTagBasedStyleId'" in sql
    assert "NULLIF(generation_prompt, 'null'::jsonb)" in sql
    assert "NULLIF(generation_positive_prompt, 'null'::jsonb)" in sql
    assert "NULLIF(request_snapshot #> '{recipe,negative_prompt}', 'null'::jsonb)" in sql
    assert "(request_snapshot -> 'recipe')::jsonb" in sql
    assert "- ARRAY[" in sql
    assert "]::text[]" in sql
    assert "AND (request_snapshot -> 'recipe') ? 'prompt_type'" in sql
    assert "INSERT INTO prompt_scenario_versions" in sql
    assert "INSERT INTO prompt_fragments" in sql

    bound_values = [
        bind.value
        for statement in statements
        for bind in getattr(statement, "_bindparams", {}).values()
    ]
    assert sum(
        isinstance(value, str) and "submit_image_prompt" in value
        for value in bound_values
    ) >= 4
    assert any(
        isinstance(value, str)
        and 'imagePrompt.promptFormat == "novelai"' in value
        and "Each character belongs in its own array item" in value
        for value in bound_values
    )

    default_document = json.loads(
        (Path(__file__).resolve().parents[1] / "prompts" / "Default.nbprompt").read_text(
            encoding="utf-8"
        )
    )
    assert migration.OBJECT_IMAGE_SYSTEM_TEMPLATE == default_document["prompts"]["imagePrompt"]["object"]["system_template"]
    assert migration.OBJECT_IMAGE_USER_TEMPLATE == default_document["prompts"]["imagePrompt"]["object"]["blocks"][2]["rangeMapping"]["user_template"]
    assert migration.SCENE_IMAGE_SYSTEM_TEMPLATE == default_document["prompts"]["imagePrompt"]["scene"]["system_template"]
    assert migration.SCENE_IMAGE_USER_TEMPLATE == default_document["prompts"]["imagePrompt"]["scene"]["blocks"][2]["rangeMapping"]["user_template"]
    assert migration.IMAGE_GUIDELINES == default_document["fragments"]["image"]["guidelines"]["content"]
