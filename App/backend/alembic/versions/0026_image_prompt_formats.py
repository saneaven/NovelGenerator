"""Replace scalar image prompts with canonical prompt-format payloads."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0026_image_prompt_formats"
down_revision = "0025_timeline_color_spread"
branch_labels = None
depends_on = None


EMPTY_STYLED_PROMPT_SQL = "jsonb_build_object('prefix', '', 'content', '', 'postfix', '')"
EMPTY_IMAGE_PROMPTS_DEFAULT = sa.text(
    "'{\"natural\":{\"prompt\":\"\"},"
    "\"positive_negative\":{\"positive\":\"\",\"negative\":\"\"},"
    "\"novelai\":{\"positive\":\"\",\"negative\":\"\",\"characters\":[]}}'::jsonb"
)

NEW_IMAGE_GEN_CONFIG_DEFAULT = sa.text(
    """'{
        "provider": "openai",
        "model": "gpt-image-2",
        "aspect_ratio": "1:1",
        "image_size": "1K",
        "naturalStyles": [],
        "positiveNegativeStyles": [],
        "novelAIStyles": [],
        "selectedNaturalStyleId": null,
        "selectedPositiveNegativeStyleId": null,
        "selectedNovelAIStyleId": null,
        "providerSettings": {
            "openai": {"quality": "medium", "background": "auto", "output_format": "png", "output_compression": 90, "moderation": "auto"},
            "novelai": {
                "sampler": "k_euler_ancestral",
                "steps": 28,
                "scale": 6.0,
                "noise_schedule": "karras",
                "referenceMode": "auto",
                "strength": 0.7,
                "i2iNoise": 0.0,
                "vibeStrength": 0.6,
                "vibeInfoExtracted": 1.0
            },
            "gemini": {},
            "xai": {},
            "openrouter": {},
            "nanogpt": {}
        }
    }'::jsonb"""
)

OLD_IMAGE_GEN_CONFIG_DEFAULT = sa.text(
    """'{
        "provider": "openai",
        "model": "gpt-image-2",
        "aspect_ratio": "1:1",
        "image_size": "1K",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": null,
        "selectedTagBasedStyleId": null,
        "providerSettings": {
            "openai": {"quality": "medium", "background": "auto", "output_format": "png", "output_compression": 90, "moderation": "auto"},
            "novelai": {
                "sampler": "k_euler_ancestral",
                "steps": 28,
                "scale": 6.0,
                "noise_schedule": "karras",
                "referenceMode": "auto",
                "strength": 0.7,
                "i2iNoise": 0.0,
                "vibeStrength": 0.6,
                "vibeInfoExtracted": 1.0
            },
            "gemini": {},
            "xai": {},
            "openrouter": {},
            "nanogpt": {}
        }
    }'::jsonb"""
)

OBJECT_IMAGE_SYSTEM_TEMPLATE = """# Image Prompt Generation

You are an expert at creating detailed, vivid image-generation prompts for project visual targets.

Always write generated prompts in English. Use the target details, the user's request, and the selected prompt format. You must call `submit_image_prompt` exactly once and output no text outside the tool call.

{% include "fragment:image/guidelines" %}"""

OBJECT_IMAGE_USER_TEMPLATE = """## Required Prompt Format

**Format:** {{ imagePrompt.promptFormat }}

{% if imagePrompt.promptFormat == "natural" %}Create one non-empty natural-language `prompt`.{% endif %}
{% if imagePrompt.promptFormat == "positive_negative" %}Create the complete `positive` and `negative` prompt pair in one call. The positive prompt must not be blank; the negative prompt may be empty.{% endif %}
{% if imagePrompt.promptFormat == "novelai" %}Create the complete NovelAI base `positive`, base `negative`, and ordered `characters` array in one call. The base positive and every character positive must not be blank. Base negative, character negative, and the character array may be empty.{% endif %}

## Current Target

{% if imagePrompt.currentTarget.basicInfo %}
**Type:** basic_info
**Title:** {{ imagePrompt.currentTarget.basicInfo.title }}
{% if imagePrompt.currentTarget.basicInfo.logline %}
**Logline:** {{ imagePrompt.currentTarget.basicInfo.logline }}
{% endif %}
{% if imagePrompt.currentTarget.basicInfo.imagePrompts %}
**Current saved prompts:** {{ imagePrompt.currentTarget.basicInfo.imagePrompts }}
{% endif %}
{% endif %}

{% if imagePrompt.currentTarget.storyEntity %}
**Type:** story_entity / {{ imagePrompt.currentTarget.storyEntity.kind }}
**Name:** {{ imagePrompt.currentTarget.storyEntity.name }}
{% if imagePrompt.currentTarget.storyEntity.description %}
**Description:** {{ imagePrompt.currentTarget.storyEntity.description }}
{% endif %}
{% if imagePrompt.currentTarget.storyEntity.content %}
## Content
{{ imagePrompt.currentTarget.storyEntity.content }}
{% endif %}
{% if imagePrompt.currentTarget.storyEntity.imagePrompts %}
**Current saved prompts:** {{ imagePrompt.currentTarget.storyEntity.imagePrompts }}
{% endif %}
{% endif %}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}

Call `submit_image_prompt` exactly once with the fields required by the selected format. Do not emit text outside the tool call."""

SCENE_IMAGE_SYSTEM_TEMPLATE = """# Scene Image Prompt Generation

You are an expert at creating cohesive scene image prompts from novel context. Always write generated prompts in English. Analyze the prose around the insertion point and the exact selected context objects, then capture the intended moment while preserving visual continuity. You must call `submit_image_prompt` exactly once and output no text outside the tool call.

{% if ((imagePrompt.selectedContextIds)|length > 0) %}
{% with ctx = select_exact_object_context(project, imagePrompt.selectedContextIds) %}
{% if ctx.storyEntities|length > 0 or ctx.outlineItems|length > 0 or ctx.manuscripts|length > 0 or ctx.timelineTracks|length > 0 or ctx.timelineEvents|length > 0 %}
## Context Objects

Use only the exact selected objects below as additional scene context.

{% if ctx.storyEntities|length > 0 %}
### Story Entities
{% for entity in ctx.storyEntities %}
#### {{ entity.kind }}: {{ entity.name }}
{% if entity.description %}{{ entity.description }}
{% endif %}
{{ entity.content }}
{% if entity.imagePrompts %}
**Saved Image Prompts:** {{ entity.imagePrompts }}
{% endif %}

{% endfor %}
{% endif %}
{% if ctx.outlineItems|length > 0 %}
### Chapter Outlines
{% for item in ctx.outlineItems %}
#### {{ item.kind }}: {{ item.name }}
{% if item.description %}{{ item.description }}
{% endif %}
{{ item.content }}

{% endfor %}
{% endif %}
{% if ctx.manuscripts|length > 0 %}
### Manuscripts
{% for manuscript in ctx.manuscripts %}
#### {{ manuscript.chapterName }}
{{ manuscript.content }}

{% endfor %}
{% endif %}
{% if ctx.timelineTracks|length > 0 %}
### Timeline Tracks
{% for track in ctx.timelineTracks %}
#### {{ track.name }}
{% if track.description %}{{ track.description }}
{% endif %}
{{ track.content }}

{% endfor %}
{% endif %}
{% if ctx.timelineEvents|length > 0 %}
### Timeline Events
{% for event in ctx.timelineEvents %}
#### {{ event.name }}
{% if event.formattedDate %}**Date:** {{ event.formattedDate }}
{% endif %}
{% if event.description %}{{ event.description }}
{% endif %}
{{ event.content }}
{% if event.tags|length > 0 %}
**Tags:** {% for tag in event.tags %}{{ tag }}{% if not loop.last %}, {% endif %}{% endfor %}
{% endif %}

{% endfor %}
{% endif %}
{% endif %}
{% endwith %}
{% endif %}

{% include "fragment:image/guidelines" %}"""

SCENE_IMAGE_USER_TEMPLATE = """## Required Prompt Format

**Format:** {{ imagePrompt.promptFormat }}

{% if imagePrompt.promptFormat == "natural" %}Create one non-empty natural-language `prompt`.{% endif %}
{% if imagePrompt.promptFormat == "positive_negative" %}Create the complete `positive` and `negative` prompt pair in one call. The positive prompt must not be blank; the negative prompt may be empty.{% endif %}
{% if imagePrompt.promptFormat == "novelai" %}Create the complete NovelAI base `positive`, base `negative`, and ordered `characters` array in one call. The base positive and every character positive must not be blank. Base negative, character negative, and the character array may be empty.{% endif %}

## Scene Context

{% if imagePrompt.sceneChapter.manuscriptId %}
### Current Story Position
{% if imagePrompt.sceneChapter.actNumber is not none %}
**Act:** {{ imagePrompt.sceneChapter.actNumber }}
{% endif %}
{% if imagePrompt.sceneChapter.chapterNumber is not none %}
**Chapter:** {{ imagePrompt.sceneChapter.chapterNumber }}
{% endif %}
{% if imagePrompt.sceneChapter.chapterName %}
**Chapter Title:** {{ imagePrompt.sceneChapter.chapterName }}
{% endif %}
Use this as structural context for the scene, but do not include act/chapter labels in the generated image prompt unless the user explicitly asks.
{% endif %}

The image will be inserted at the cursor position in the novel.

### Context
<before>{{ imagePrompt.scenePreContext }}</before>[Image Insert Point]<after>{{ imagePrompt.scenePostContext }}</after>

### Focus Point
Focus on the scene immediately following the insertion point:
```
{{ imagePrompt.scenePostContext[:100] | trim }}...
```

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}

Call `submit_image_prompt` exactly once with the fields required by the selected format. Do not emit text outside the tool call."""

IMAGE_GUIDELINES = """## Prompt Style Guidelines

{% if imagePrompt.promptFormat == "natural" %}
- Write a vivid, coherent natural-language prompt with composition, subjects, atmosphere, lighting, and an appropriate color palette.
{% endif %}

{% if imagePrompt.promptFormat == "positive_negative" %}
- Put everything the image should contain in `positive` and unwanted visual elements in `negative`.
- Return the complete pair in the same tool call.
{% endif %}

{% if imagePrompt.promptFormat == "novelai" %}
- NovelAI prompts may use tags, natural prose, or a useful English hybrid.
- Put scene composition, style, environment, global details, and numbered subject-count tags such as `2girls` in the base positive prompt.
- Put each individual character's unnumbered type, appearance, action, hair, face, outfit, and distinguishing details in that character's positive prompt. Do not use a character's project name as a visual tag.
- Put global exclusions in the base negative prompt. Put traits that must not bleed into that character from another character in the corresponding character negative prompt.
- Preserve the intended on-canvas reading order in the `characters` array.
- For interactions, `source#`, `target#`, and `mutual#` action tags may be used when helpful.
- Never flatten character prompts with the pipe (`|`) syntax. Each character belongs in its own array item.
- Do not duplicate automatic quality tags or undesired-content presets.
{% endif %}"""

SYSTEM_PROMPT_MIGRATION_NOTE = "System default image prompt ToolEngine migration"


def _upgrade_object_table(table_name: str) -> None:
    op.add_column(table_name, sa.Column("image_prompts", postgresql.JSONB(), nullable=True))
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET image_prompts = jsonb_build_object(
                'natural', jsonb_build_object('prompt', COALESCE(image_prompt, '')),
                'positive_negative', jsonb_build_object(
                    'positive', COALESCE(image_prompt_positive, ''),
                    'negative', COALESCE(image_prompt_negative, '')
                ),
                'novelai', jsonb_build_object(
                    'positive', COALESCE(image_prompt_positive, ''),
                    'negative', COALESCE(image_prompt_negative, ''),
                    'characters', '[]'::jsonb
                )
            )
            """
        )
    )
    op.alter_column(
        table_name,
        "image_prompts",
        existing_type=postgresql.JSONB(),
        nullable=False,
        server_default=EMPTY_IMAGE_PROMPTS_DEFAULT,
    )
    op.drop_column(table_name, "image_prompt_negative")
    op.drop_column(table_name, "image_prompt_positive")
    op.drop_column(table_name, "image_prompt")


def _downgrade_object_table(table_name: str) -> None:
    op.add_column(table_name, sa.Column("image_prompt", sa.Text(), nullable=True))
    op.add_column(table_name, sa.Column("image_prompt_positive", sa.Text(), nullable=True))
    op.add_column(table_name, sa.Column("image_prompt_negative", sa.Text(), nullable=True))
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET image_prompt = NULLIF(image_prompts #>> '{{natural,prompt}}', ''),
                image_prompt_positive = NULLIF(image_prompts #>> '{{novelai,positive}}', ''),
                image_prompt_negative = NULLIF(image_prompts #>> '{{novelai,negative}}', '')
            """
        )
    )
    op.drop_column(table_name, "image_prompts")


def _migrate_system_default_image_prompts() -> None:
    scenario_sql = sa.text(
        """
        INSERT INTO prompt_scenario_versions (
            id,
            user_id,
            preset_id,
            task_type,
            task_subtype,
            scenario,
            version_number,
            is_default,
            created_at,
            note
        )
        SELECT
            CAST(md5(CAST(current.id AS text) || :id_salt) AS uuid),
            current.user_id,
            current.preset_id,
            current.task_type,
            current.task_subtype,
            jsonb_set(
                jsonb_set(
                    current.scenario,
                    '{system_template}',
                    to_jsonb(CAST(:system_template AS text)),
                    false
                ),
                '{blocks,2,rangeMapping,user_template}',
                to_jsonb(CAST(:user_template AS text)),
                false
            ),
            current.version_number + 1,
            true,
            CURRENT_TIMESTAMP,
            :migration_note
        FROM prompt_scenario_versions AS current
        WHERE current.task_type = 'imagePrompt'
          AND current.task_subtype = :task_subtype
          AND current.is_default = true
          AND current.version_number = (
              SELECT MAX(candidate.version_number)
              FROM prompt_scenario_versions AS candidate
              WHERE candidate.preset_id = current.preset_id
                AND candidate.task_type = current.task_type
                AND candidate.task_subtype = current.task_subtype
          )
        """
    )
    for task_subtype, system_template, user_template in (
        ("object", OBJECT_IMAGE_SYSTEM_TEMPLATE, OBJECT_IMAGE_USER_TEMPLATE),
        ("scene", SCENE_IMAGE_SYSTEM_TEMPLATE, SCENE_IMAGE_USER_TEMPLATE),
    ):
        op.execute(
            scenario_sql.bindparams(
                id_salt=f":0026:{task_subtype}",
                system_template=system_template,
                user_template=user_template,
                migration_note=SYSTEM_PROMPT_MIGRATION_NOTE,
                task_subtype=task_subtype,
            )
        )

    op.execute(
        sa.text(
            """
            INSERT INTO prompt_fragments (
                id,
                user_id,
                preset_id,
                folder_id,
                fragment_name,
                content,
                description,
                version_number,
                note,
                created_at,
                updated_at
            )
            SELECT
                CAST(md5(CAST(current.id AS text) || ':0026:image-guidelines') AS uuid),
                current.user_id,
                current.preset_id,
                current.folder_id,
                current.fragment_name,
                :guidelines,
                current.description,
                current.version_number + 1,
                :migration_note,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM prompt_fragments AS current
            JOIN prompt_folders AS folder ON folder.id = current.folder_id
            WHERE folder.name = 'image'
              AND folder.parent_id IS NULL
              AND current.fragment_name = 'guidelines'
              AND current.note = 'System default'
              AND current.version_number = (
                  SELECT MAX(candidate.version_number)
                  FROM prompt_fragments AS candidate
                  WHERE candidate.preset_id = current.preset_id
                    AND candidate.folder_id = current.folder_id
                    AND candidate.fragment_name = current.fragment_name
              )
            """
        ).bindparams(
            guidelines=IMAGE_GUIDELINES,
            migration_note=SYSTEM_PROMPT_MIGRATION_NOTE,
        )
    )


def _remove_migrated_system_default_image_prompts() -> None:
    op.execute(
        sa.text(
            "DELETE FROM prompt_fragments WHERE note = :migration_note"
        ).bindparams(migration_note=SYSTEM_PROMPT_MIGRATION_NOTE)
    )
    op.execute(
        sa.text(
            "DELETE FROM prompt_scenario_versions WHERE note = :migration_note"
        ).bindparams(migration_note=SYSTEM_PROMPT_MIGRATION_NOTE)
    )


def upgrade() -> None:
    _upgrade_object_table("basic_info")
    _upgrade_object_table("story_entities")

    op.add_column("assets", sa.Column("generation_prompt_format", sa.String(length=32), nullable=True))
    op.add_column("assets", sa.Column("generation_prompt_data", postgresql.JSONB(), nullable=True))
    op.execute(
        sa.text(
            f"""
            UPDATE assets
            SET generation_prompt_format = CASE
                    WHEN NULLIF(generation_prompt, 'null'::jsonb) IS NOT NULL THEN 'natural'
                    WHEN NULLIF(generation_positive_prompt, 'null'::jsonb) IS NOT NULL
                      OR NULLIF(generation_negative_prompt, 'null'::jsonb) IS NOT NULL THEN 'novelai'
                    ELSE NULL
                END,
                generation_prompt_data = CASE
                    WHEN NULLIF(generation_prompt, 'null'::jsonb) IS NOT NULL THEN
                        jsonb_build_object('prompt', NULLIF(generation_prompt, 'null'::jsonb))
                    WHEN NULLIF(generation_positive_prompt, 'null'::jsonb) IS NOT NULL
                      OR NULLIF(generation_negative_prompt, 'null'::jsonb) IS NOT NULL THEN
                        jsonb_build_object(
                            'positive', COALESCE(NULLIF(generation_positive_prompt, 'null'::jsonb), {EMPTY_STYLED_PROMPT_SQL}),
                            'negative', COALESCE(NULLIF(generation_negative_prompt, 'null'::jsonb), {EMPTY_STYLED_PROMPT_SQL}),
                            'characters', '[]'::jsonb
                        )
                    ELSE NULL
                END
            """
        )
    )
    op.drop_column("assets", "generation_negative_prompt")
    op.drop_column("assets", "generation_positive_prompt")
    op.drop_column("assets", "generation_prompt")

    op.execute(
        sa.text(
            """
            UPDATE image_runs
            SET request_snapshot = jsonb_set(
                request_snapshot,
                '{recipe}',
                ((request_snapshot -> 'recipe')::jsonb
                    - ARRAY[
                        'prompt_type',
                        'prompt',
                        'positive_prompt',
                        'negative_prompt'
                    ]::text[])
                || jsonb_build_object(
                    'prompt_format', CASE
                        WHEN request_snapshot #>> '{recipe,prompt_type}' = 'natural' THEN 'natural'
                        ELSE 'novelai'
                    END,
                    'prompt_data', CASE
                        WHEN request_snapshot #>> '{recipe,prompt_type}' = 'natural' THEN
                            jsonb_build_object(
                                'prompt', COALESCE(
                                    NULLIF(request_snapshot #> '{recipe,prompt}', 'null'::jsonb),
                                    jsonb_build_object('prefix', '', 'content', '', 'postfix', '')
                                )
                            )
                        ELSE jsonb_build_object(
                            'positive', COALESCE(
                                NULLIF(request_snapshot #> '{recipe,positive_prompt}', 'null'::jsonb),
                                jsonb_build_object('prefix', '', 'content', '', 'postfix', '')
                            ),
                            'negative', COALESCE(
                                NULLIF(request_snapshot #> '{recipe,negative_prompt}', 'null'::jsonb),
                                jsonb_build_object('prefix', '', 'content', '', 'postfix', '')
                            ),
                            'characters', '[]'::jsonb
                        )
                    END
                ),
                false
            )
            WHERE request_snapshot ? 'recipe'
              AND (request_snapshot -> 'recipe') ? 'prompt_type'
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config =
                (image_gen_config - 'tagBasedStyles' - 'selectedTagBasedStyleId')
                || jsonb_build_object(
                    'positiveNegativeStyles', '[]'::jsonb,
                    'novelAIStyles', COALESCE(NULLIF(image_gen_config->'tagBasedStyles', 'null'::jsonb), '[]'::jsonb),
                    'selectedPositiveNegativeStyleId', NULL,
                    'selectedNovelAIStyleId', image_gen_config->'selectedTagBasedStyleId'
                )
            """
        )
    )

    op.alter_column(
        "user_settings",
        "image_gen_config",
        existing_type=postgresql.JSONB(),
        nullable=False,
        server_default=NEW_IMAGE_GEN_CONFIG_DEFAULT,
    )
    _migrate_system_default_image_prompts()


def downgrade() -> None:
    _remove_migrated_system_default_image_prompts()
    op.alter_column(
        "user_settings",
        "image_gen_config",
        existing_type=postgresql.JSONB(),
        nullable=False,
        server_default=OLD_IMAGE_GEN_CONFIG_DEFAULT,
    )
    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config =
                (image_gen_config
                    - 'positiveNegativeStyles'
                    - 'novelAIStyles'
                    - 'selectedPositiveNegativeStyleId'
                    - 'selectedNovelAIStyleId')
                || jsonb_build_object(
                    'tagBasedStyles', COALESCE(image_gen_config->'novelAIStyles', '[]'::jsonb),
                    'selectedTagBasedStyleId', image_gen_config->'selectedNovelAIStyleId'
                )
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE image_runs
            SET request_snapshot = jsonb_set(
                request_snapshot,
                '{recipe}',
                ((request_snapshot -> 'recipe')::jsonb
                    - ARRAY['prompt_format', 'prompt_data']::text[])
                || jsonb_build_object(
                    'prompt_type', CASE
                        WHEN request_snapshot #>> '{recipe,prompt_format}' = 'natural' THEN 'natural'
                        ELSE 'tag_based'
                    END,
                    'prompt', request_snapshot #> '{recipe,prompt_data,prompt}',
                    'positive_prompt', request_snapshot #> '{recipe,prompt_data,positive}',
                    'negative_prompt', request_snapshot #> '{recipe,prompt_data,negative}'
                ),
                false
            )
            WHERE request_snapshot ? 'recipe'
              AND (request_snapshot -> 'recipe') ? 'prompt_format'
            """
        )
    )

    op.add_column("assets", sa.Column("generation_prompt", postgresql.JSONB(), nullable=True))
    op.add_column("assets", sa.Column("generation_positive_prompt", postgresql.JSONB(), nullable=True))
    op.add_column("assets", sa.Column("generation_negative_prompt", postgresql.JSONB(), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE assets
            SET generation_prompt = CASE
                    WHEN generation_prompt_format = 'natural' THEN generation_prompt_data->'prompt'
                    ELSE NULL
                END,
                generation_positive_prompt = CASE
                    WHEN generation_prompt_format <> 'natural' THEN generation_prompt_data->'positive'
                    ELSE NULL
                END,
                generation_negative_prompt = CASE
                    WHEN generation_prompt_format <> 'natural' THEN generation_prompt_data->'negative'
                    ELSE NULL
                END
            """
        )
    )
    op.drop_column("assets", "generation_prompt_data")
    op.drop_column("assets", "generation_prompt_format")

    _downgrade_object_table("story_entities")
    _downgrade_object_table("basic_info")
