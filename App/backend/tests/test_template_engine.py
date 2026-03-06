from __future__ import annotations

import pytest
from jinja2.sandbox import SecurityError

from App.backend.services.template_engine import (
    FragmentNotFoundError,
    create_environment,
    render_template,
    validate_template_source,
)


def test_render_template_supports_fragment_include() -> None:
    env = create_environment(fragment_map={"common/projectContext/full": "Project context"})

    rendered = render_template(env, '{% include "fragment:common/projectContext/full" %}', {})

    assert rendered == "Project context"


def test_render_template_supports_with_plus_include() -> None:
    env = create_environment(fragment_map={"translation/filteredContext": "Lang={{ lang }}, Ids={{ ids|length }}"})

    rendered = render_template(
        env,
        '{% with lang = "English", ids = ["a", "b"] %}{% include "fragment:translation/filteredContext" %}{% endwith %}',
        {},
    )

    assert rendered == "Lang=English, Ids=2"


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


def test_render_template_raises_fragment_not_found_for_bare_paths() -> None:
    env = create_environment(fragment_map={"common/projectContext/full": "Project context"})

    with pytest.raises(FragmentNotFoundError) as exc:
        render_template(env, '{% include "common/projectContext/full" %}', {})

    assert exc.value.path == "common/projectContext/full"
