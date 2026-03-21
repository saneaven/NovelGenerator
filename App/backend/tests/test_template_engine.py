from __future__ import annotations

import pytest
from jinja2.sandbox import SecurityError

from App.backend.services.template_engine import (
    FragmentNotFoundError,
    create_environment,
    render_template,
    validate_template_source,
)


def _project_fixture() -> dict[str, object]:
    story_entity = {
        "type": "story_entity",
        "kind": "character",
        "id": "entity-1",
        "name": "Ari",
        "description": "Broker",
        "content": "Detailed content",
        "folderId": "folder-1",
        "folderPath": ["Characters", "Main Cast"],
        "displayOrder": 0,
    }
    root_entity = {
        "type": "story_entity",
        "kind": "location",
        "id": "entity-2",
        "name": "Port Meridian",
        "description": "Trade city",
        "content": "Fog and lanterns",
        "folderId": None,
        "folderPath": [],
        "displayOrder": 1,
    }
    outline_tree = [
        {
            "id": "outline-1",
            "kind": "outline",
            "name": "Main Outline",
            "description": "Primary story spine",
            "content": "Outline content",
            "parentId": None,
            "position": 0,
            "children": [
                {
                    "id": "act-1",
                    "kind": "act",
                    "name": "Setup",
                    "description": "Opening movement",
                    "content": "Act content",
                    "parentId": "outline-1",
                    "position": 0,
                    "actNumber": 1,
                    "children": [
                        {
                            "id": "chapter-1",
                            "kind": "chapter",
                            "name": "The Raid",
                            "description": "Inciting chapter",
                            "content": "Chapter content",
                            "parentId": "act-1",
                            "position": 0,
                            "actNumber": 1,
                            "chapterNumber": 1,
                            "manuscriptId": "ms-1",
                            "children": [],
                        }
                    ],
                }
                ,
                {
                    "id": "act-2",
                    "kind": "act",
                    "name": "Counterattack",
                    "description": "Escalation movement",
                    "content": "Act two content",
                    "parentId": "outline-1",
                    "position": 1,
                    "actNumber": 2,
                    "children": [
                        {
                            "id": "chapter-2",
                            "kind": "chapter",
                            "name": "The Escape",
                            "description": "Second chapter",
                            "content": "Chapter two content",
                            "parentId": "act-2",
                            "position": 0,
                            "actNumber": 2,
                            "chapterNumber": 2,
                            "manuscriptId": "ms-2",
                            "children": [],
                        }
                    ],
                },
            ],
        }
    ]
    outline_nodes = [
        {
            "id": "outline-1",
            "kind": "outline",
            "name": "Main Outline",
            "description": "Primary story spine",
            "content": "Outline content",
            "parentId": None,
            "position": 0,
        },
        {
            "id": "act-1",
            "kind": "act",
            "name": "Setup",
            "description": "Opening movement",
            "content": "Act content",
            "parentId": "outline-1",
            "position": 0,
            "actNumber": 1,
        },
        {
            "id": "chapter-1",
            "kind": "chapter",
            "name": "The Raid",
            "description": "Inciting chapter",
            "content": "Chapter content",
            "parentId": "act-1",
            "position": 0,
            "actNumber": 1,
            "chapterNumber": 1,
            "manuscriptId": "ms-1",
        },
        {
            "id": "act-2",
            "kind": "act",
            "name": "Counterattack",
            "description": "Escalation movement",
            "content": "Act two content",
            "parentId": "outline-1",
            "position": 1,
            "actNumber": 2,
        },
        {
            "id": "chapter-2",
            "kind": "chapter",
            "name": "The Escape",
            "description": "Second chapter",
            "content": "Chapter two content",
            "parentId": "act-2",
            "position": 0,
            "actNumber": 2,
            "chapterNumber": 2,
            "manuscriptId": "ms-2",
        },
    ]
    return {
        "basicInfo": {
            "id": "basic-1",
            "title": "Project",
            "logline": "Hook",
            "genres": ["Fantasy"],
            "tags": ["academy"],
        },
        "guidelines": {"id": "guide-1", "authorNote": "Keep it tense."},
        "storyEntities": [story_entity, root_entity],
        "storyEntityTree": [
            {
                "nodeType": "folder",
                "id": "folder-1",
                "name": "Characters",
                "children": [
                    {
                        "nodeType": "story_entity",
                        "entity": story_entity,
                    }
                ],
            },
            {
                "nodeType": "story_entity",
                "entity": root_entity,
            },
        ],
        "outline": {"nodes": outline_nodes, "tree": outline_tree},
        "manuscripts": [
            {
                "id": "ms-1",
                "chapterId": "chapter-1",
                "chapterName": "The Raid",
                "actNumber": 1,
                "chapterNumber": 1,
                "content": "Scene text",
                "wordCount": 100,
            },
            {
                "id": "ms-2",
                "chapterId": "chapter-2",
                "chapterName": "The Escape",
                "actNumber": 2,
                "chapterNumber": 2,
                "content": "Scene two text",
                "wordCount": 120,
            }
        ],
        "contentByLang": {
            "Korean": {
                "basicInfo": {
                    "id": "basic-1",
                    "title": "프로젝트",
                    "logline": "후크",
                    "genres": ["판타지"],
                    "tags": ["학원"],
                },
                "guidelines": {"id": "guide-1", "authorNote": "긴장을 유지하라."},
                "storyEntities": [
                    {
                        **story_entity,
                        "name": "아리",
                        "description": "정보 중개인",
                        "content": "상세 내용",
                    }
                ],
                "storyEntityTree": [
                    {
                        "nodeType": "folder",
                        "id": "folder-1",
                        "name": "등장인물",
                        "children": [
                            {
                                "nodeType": "story_entity",
                                "entity": {
                                    **story_entity,
                                    "name": "아리",
                                    "description": "정보 중개인",
                                    "content": "상세 내용",
                                },
                            }
                        ],
                    }
                ],
                "outline": {"nodes": outline_nodes, "tree": outline_tree},
                "manuscripts": [],
            }
        },
    }


def test_render_template_supports_fragment_include() -> None:
    env = create_environment(fragment_map={"common/objectContext": "Object context"})

    rendered = render_template(env, '{% include "fragment:common/objectContext" %}', {})

    assert rendered == "Object context"


def test_render_template_supports_with_plus_include() -> None:
    env = create_environment(fragment_map={"translation/objectContext": "Lang={{ lang }}, Ids={{ ids|length }}"})

    rendered = render_template(
        env,
        '{% with lang = "English", ids = ["a", "b"] %}{% include "fragment:translation/objectContext" %}{% endwith %}',
        {},
    )

    assert rendered == "Lang=English, Ids=2"


def test_render_template_supports_select_object_context_helper() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_object_context(project, ["guide-1", "entity-1", "chapter-1", "ms-1"]) %}'
        '{{ ctx.guidelines.authorNote }}|{{ ctx.storyEntities[0].name }}|{{ ctx.outlineTree[0].children[0].children[0].name }}|{{ ctx.manuscripts[0].chapterName }}',
        {"project": project},
    )

    assert rendered == "Keep it tense.|Ari|The Raid|The Raid"


def test_render_template_supports_select_object_context_by_lang_helper() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_object_context_by_lang(project, "Korean", ["entity-1"]) %}{{ ctx.storyEntities[0].name }}',
        {"project": project},
    )

    assert rendered == "아리"


def test_render_template_supports_local_tree_macros_for_xml() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% macro render_story_entity_nodes(nodes) -%}'
        '{% for node in nodes %}'
        '{% if node.nodeType == "folder" %}'
        '<folder id="{{ node.id|e }}" name="{{ node.name|e }}">{{ render_story_entity_nodes(node.children) }}</folder>'
        '{% elif node.nodeType == "story_entity" %}'
        '<story-entity id="{{ node.entity.id|e }}" kind="{{ node.entity.kind|e }}">'
        '<name>{{ node.entity.name|e }}</name>'
        '<description>{{ node.entity.description|e }}</description>'
        '<content>{{ node.entity.content|e }}</content>'
        '</story-entity>'
        '{% endif %}'
        '{% endfor %}'
        '{%- endmacro %}'
        '{% macro render_outline_nodes(nodes) -%}'
        '{% for node in nodes %}'
        '{% if node.kind == "outline" %}'
        '<outline id="{{ node.id|e }}" name="{{ node.name|e }}">{{ render_outline_nodes(node.children or []) }}</outline>'
        '{% elif node.kind == "act" %}'
        '<outline-act id="{{ node.id|e }}" name="{{ node.name|e }}" act-number="{{ node.actNumber|e }}">{{ render_outline_nodes(node.children or []) }}</outline-act>'
        '{% elif node.kind == "chapter" %}'
        '<outline-chapter id="{{ node.id|e }}" name="{{ node.name|e }}" act-number="{{ node.actNumber|e }}" chapter-number="{{ node.chapterNumber|e }}"{% if node.manuscriptId %} manuscript-id="{{ node.manuscriptId|e }}"{% endif %}>{{ render_outline_nodes(node.children or []) }}</outline-chapter>'
        '{% endif %}'
        '{% endfor %}'
        '{%- endmacro %}'
        '{% set ctx = select_object_context(project, ["entity-1", "chapter-1", "ms-1"]) %}'
        '<story-entity-tree>{{ render_story_entity_nodes(ctx.storyEntityTree) }}</story-entity-tree>'
        '<outline-structure>{{ render_outline_nodes(ctx.outlineTree) }}</outline-structure>',
        {"project": project},
    )

    assert '<folder id="folder-1" name="Characters">' in rendered
    assert '<story-entity id="entity-1" kind="character">' in rendered
    assert '<content>Detailed content</content>' in rendered
    assert '<outline-act id="act-1" name="Setup" act-number="1">' in rendered
    assert '<outline-chapter id="chapter-1" name="The Raid" act-number="1" chapter-number="1" manuscript-id="ms-1">' in rendered
    assert "Port Meridian" not in rendered


def test_render_template_supports_local_tree_macros_for_markdown() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% macro render_story_tree(nodes) -%}\n'
        '{% for node in nodes %}\n'
        '{% if node.nodeType == "folder" %}\n'
        '## Folder: {{ node.name }}\n'
        '{{ render_story_tree(node.children) }}\n'
        '{% elif node.nodeType == "story_entity" %}\n'
        '- {{ node.entity.kind }}: {{ node.entity.name }}\n'
        '{% endif %}\n'
        '{% endfor %}\n'
        '{%- endmacro %}\n'
        '{% set ctx = select_object_context(project, ["entity-1", "entity-2"]) %}\n'
        '{{ render_story_tree(ctx.storyEntityTree) }}',
        {"project": project},
    )

    assert "## Folder: Characters" in rendered
    assert "- character: Ari" in rendered
    assert "- location: Port Meridian" in rendered


def test_render_template_preserves_canonical_selected_outline_and_manuscript_numbers() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% macro render_outline_nodes(nodes) -%}'
        '{% for node in nodes %}'
        '{% if node.kind == "outline" %}'
        '<outline id="{{ node.id|e }}" name="{{ node.name|e }}">{{ render_outline_nodes(node.children or []) }}</outline>'
        '{% elif node.kind == "act" %}'
        '<outline-act id="{{ node.id|e }}" name="{{ node.name|e }}" act-number="{{ node.actNumber|e }}">{{ render_outline_nodes(node.children or []) }}</outline-act>'
        '{% elif node.kind == "chapter" %}'
        '<outline-chapter id="{{ node.id|e }}" name="{{ node.name|e }}" act-number="{{ node.actNumber|e }}" chapter-number="{{ node.chapterNumber|e }}"{% if node.manuscriptId %} manuscript-id="{{ node.manuscriptId|e }}"{% endif %}></outline-chapter>'
        '{% endif %}'
        '{% endfor %}'
        '{%- endmacro %}'
        '{% macro render_manuscripts(manuscripts) -%}'
        '{% for manuscript in manuscripts %}'
        '<manuscript id="{{ manuscript.id|e }}" chapter-id="{{ manuscript.chapterId|e }}" chapter-name="{{ manuscript.chapterName|e }}"{% if manuscript.actNumber is not none %} act-number="{{ manuscript.actNumber|e }}"{% endif %}{% if manuscript.chapterNumber is not none %} chapter-number="{{ manuscript.chapterNumber|e }}"{% endif %}></manuscript>'
        '{% endfor %}'
        '{%- endmacro %}'
        '{% set ctx = select_object_context(project, ["chapter-2", "ms-2"]) %}'
        '<outline-structure>{{ render_outline_nodes(ctx.outlineTree) }}</outline-structure>'
        '<manuscripts>{{ render_manuscripts(ctx.manuscripts) }}</manuscripts>',
        {"project": project},
    )

    assert '<outline-act id="act-2" name="Counterattack" act-number="2">' in rendered
    assert '<outline-chapter id="chapter-2" name="The Escape" act-number="2" chapter-number="2" manuscript-id="ms-2"></outline-chapter>' in rendered
    assert '<manuscript id="ms-2" chapter-id="chapter-2" chapter-name="The Escape" act-number="2" chapter-number="2"></manuscript>' in rendered
    assert 'chapter-number="1"' not in rendered


def test_create_environment_does_not_register_format_specific_renderers() -> None:
    env = create_environment()

    legacy_renderer_names = (
        "render_" + "story_entity_context_tree",
        "render_" + "story_entity_index_tree",
        "render_" + "outline_context_tree",
        "render_" + "outline_index_tree",
        "render_" + "manuscript_context_nodes",
        "render_" + "manuscript_index_nodes",
    )
    for name in legacy_renderer_names:
        assert name not in env.globals


def test_validate_template_source_rejects_prompt_calls() -> None:
    report = validate_template_source('{{ prompt("translation/tools") }}', fragment_map={})

    assert report.errors == ['prompt() is no longer supported. Use {% include "fragment:..." %}.']


def test_validate_template_source_detects_missing_fragment() -> None:
    report = validate_template_source('{% include "fragment:missing/path" %}', fragment_map={})

    assert report.errors == ["Referenced fragment not found: fragment:missing/path"]
    assert report.referenced_fragments == ["fragment:missing/path"]


def test_validate_template_source_respects_ignore_missing() -> None:
    report = validate_template_source('{% include "fragment:missing/path" ignore missing %}', fragment_map={})

    assert report.errors == []
    assert report.referenced_fragments == ["fragment:missing/path"]


def test_validate_template_source_detects_cycles() -> None:
    report = validate_template_source(
        '{% include "fragment:common/a" %}',
        fragment_map={
            "common/a": '{% include "fragment:common/b" %}',
            "common/b": '{% include "fragment:common/a" %}',
        },
    )

    assert report.errors == [
        "Circular fragment reference detected: fragment:common/a -> fragment:common/b -> fragment:common/a"
    ]


def test_render_template_blocks_private_attribute_access() -> None:
    env = create_environment()

    with pytest.raises(SecurityError):
        render_template(env, "{{ ''.__class__ }}", {})


def test_render_template_blocks_mutation_methods() -> None:
    env = create_environment()

    with pytest.raises(SecurityError):
        render_template(env, '{{ data.update({"x": 1}) }}', {"data": {}})


def test_select_exact_object_context_returns_flat_selected_only() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_exact_object_context(project, ["entity-1", "chapter-2", "ms-1"]) %}'
        "entities={{ ctx.storyEntities|length }}"
        ",folders={{ ctx.storyEntityFolders|length }}"
        ",outlines={{ ctx.outlineItems|length }}"
        ",manuscripts={{ ctx.manuscripts|length }}"
        ",entity_name={{ ctx.storyEntities[0].name }}"
        ",outline_kind={{ ctx.outlineItems[0].kind }}"
        ",ms_chapter={{ ctx.manuscripts[0].chapterName }}",
        {"project": project},
    )

    assert "entities=1" in rendered
    assert "folders=0" in rendered
    assert "outlines=1" in rendered
    assert "manuscripts=1" in rendered
    assert "entity_name=Ari" in rendered
    assert "outline_kind=chapter" in rendered
    assert "ms_chapter=The Raid" in rendered


def test_select_exact_object_context_no_parent_auto_inclusion() -> None:
    """Selecting a chapter must NOT auto-include its parent act or outline."""
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_exact_object_context(project, ["chapter-2"]) %}'
        "outlines={{ ctx.outlineItems|length }}"
        ",kind={{ ctx.outlineItems[0].kind }}",
        {"project": project},
    )

    assert "outlines=1" in rendered
    assert "kind=chapter" in rendered


def test_select_exact_object_context_includes_folder_when_selected() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_exact_object_context(project, ["folder-1"]) %}'
        "folders={{ ctx.storyEntityFolders|length }}"
        ",entities={{ ctx.storyEntities|length }}"
        ",folder_name={{ ctx.storyEntityFolders[0].name }}",
        {"project": project},
    )

    assert "folders=1" in rendered
    assert "entities=0" in rendered
    assert "folder_name=Characters" in rendered


def test_select_exact_object_context_by_lang() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_exact_object_context_by_lang(project, "Korean", ["entity-1"]) %}'
        "{{ ctx.storyEntities[0].name }}",
        {"project": project},
    )

    assert rendered.strip() == "아리"


def test_select_tree_object_context_marks_selected_flag() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_tree_object_context(project, ["chapter-2", "ms-2"]) %}'
        "outline_selected={{ ctx.outlineTree[0].selected }}"
        ",act_selected={{ ctx.outlineTree[0].children[0].selected }}"
        ",chapter_selected={{ ctx.outlineTree[0].children[0].children[0].selected }}",
        {"project": project},
    )

    assert "outline_selected=False" in rendered
    assert "act_selected=False" in rendered
    assert "chapter_selected=True" in rendered


def test_select_tree_object_context_prunes_empty_branches() -> None:
    """Act-1 branch has no selected nodes so it should be pruned."""
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_tree_object_context(project, ["chapter-2"]) %}'
        "acts={{ ctx.outlineTree[0].children|length }}"
        ",act_name={{ ctx.outlineTree[0].children[0].name }}",
        {"project": project},
    )

    assert "acts=1" in rendered
    assert "act_name=Counterattack" in rendered


def test_select_tree_object_context_story_entity_selected_flag() -> None:
    env = create_environment()
    project = _project_fixture()

    rendered = render_template(
        env,
        '{% set ctx = select_tree_object_context(project, ["entity-1"]) %}'
        "folder_selected={{ ctx.storyEntityTree[0].selected }}"
        ",entity_selected={{ ctx.storyEntityTree[0].children[0].selected }}",
        {"project": project},
    )

    assert "folder_selected=False" in rendered
    assert "entity_selected=True" in rendered


def test_render_template_raises_fragment_not_found_for_bare_paths() -> None:
    env = create_environment(fragment_map={"common/objectContext": "Object context"})

    with pytest.raises(FragmentNotFoundError) as exc:
        render_template(env, '{% include "common/objectContext" %}', {})

    assert exc.value.path == "common/objectContext"
