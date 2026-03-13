from __future__ import annotations

import pytest

from App.backend.services.search_memory_settings import (
    clear_dimensions_for_target,
    has_search_memory_override,
    make_initial_search_memory_settings,
    make_memory_override_seed,
    make_search_override_seed,
    resolve_memory_settings,
    resolve_search_settings,
    validate_search_memory_settings,
)


def test_resolve_settings_inherit_general_when_overrides_are_missing() -> None:
    settings = make_initial_search_memory_settings()
    settings["general"]["embedding"]["model"] = "general-model"
    settings["general"]["embedding"]["dimensions"] = 1536
    settings["general"]["retrieval"]["topKPerQuery"] = 12
    settings["general"]["keywordPageSize"] = 33

    resolved_search = resolve_search_settings(settings)
    resolved_memory = resolve_memory_settings(settings)

    assert resolved_search["embedding"]["model"] == "general-model"
    assert resolved_search["keywordPageSize"] == 33
    assert resolved_memory["embedding"]["model"] == "general-model"
    assert resolved_memory["retrieval"]["topKPerQuery"] == 12


def test_null_override_placeholders_are_not_treated_as_active_overrides() -> None:
    settings = make_initial_search_memory_settings()

    validated = validate_search_memory_settings(settings)

    assert validated["overrides"]["search"] is None
    assert validated["overrides"]["memory"] is None
    assert has_search_memory_override(settings, "search") is False
    assert has_search_memory_override(settings, "memory") is False


def test_override_seed_and_resolution_use_target_specific_values() -> None:
    settings = make_initial_search_memory_settings()
    settings["general"]["embedding"]["model"] = "general-model"
    settings["general"]["retrieval"]["maxPrimaryItems"] = 9
    settings["general"]["keywordPageSize"] = 25

    search_override = make_search_override_seed(settings)
    memory_override = make_memory_override_seed(settings)
    search_override["embedding"]["model"] = "search-model"
    search_override["keywordPageSize"] = 7
    memory_override["embedding"]["model"] = "memory-model"

    settings["overrides"]["search"] = search_override
    settings["overrides"]["memory"] = memory_override

    assert has_search_memory_override(settings, "search") is True
    assert has_search_memory_override(settings, "memory") is True
    assert resolve_search_settings(settings)["embedding"]["model"] == "search-model"
    assert resolve_search_settings(settings)["keywordPageSize"] == 7
    assert resolve_memory_settings(settings)["embedding"]["model"] == "memory-model"
    assert resolve_memory_settings(settings)["retrieval"]["maxPrimaryItems"] == 9


def test_validate_search_memory_settings_rejects_invalid_override_keys_and_caps() -> None:
    settings = make_initial_search_memory_settings()
    settings["overrides"] = {"unknown": make_search_override_seed(settings)}

    with pytest.raises(ValueError):
        validate_search_memory_settings(settings)

    settings = make_initial_search_memory_settings()
    settings["general"]["retrieval"]["maxPrimaryItems"] = 10
    settings["general"]["retrieval"]["maxTotalItems"] = 9

    with pytest.raises(ValueError, match="maxTotalItems"):
        validate_search_memory_settings(settings)


def test_validate_search_memory_settings_allows_disabled_incomplete_but_rejects_enabled_incomplete() -> None:
    disabled_settings = make_initial_search_memory_settings()
    disabled_settings["enabled"] = False

    validated = validate_search_memory_settings(disabled_settings)
    assert validated["general"]["embedding"]["model"] == ""

    enabled_settings = make_initial_search_memory_settings()
    enabled_settings["overrides"]["memory"] = make_memory_override_seed(enabled_settings)
    enabled_settings["overrides"]["memory"]["embedding"]["model"] = "memory-model"
    enabled_settings["enabled"] = True
    enabled_settings["general"]["embedding"]["model"] = ""

    with pytest.raises(ValueError, match="Search embedding provider/model is required"):
        validate_search_memory_settings(enabled_settings)


def test_clear_dimensions_for_target_uses_effective_storage_location() -> None:
    settings = make_initial_search_memory_settings()
    settings["general"]["embedding"]["dimensions"] = 1536
    settings["overrides"]["memory"] = make_memory_override_seed(settings)
    settings["overrides"]["memory"]["embedding"]["dimensions"] = 3072

    search_cleared = clear_dimensions_for_target(settings, "search")
    assert search_cleared["general"]["embedding"]["dimensions"] is None
    assert search_cleared["overrides"]["memory"]["embedding"]["dimensions"] == 3072

    memory_cleared = clear_dimensions_for_target(settings, "memory")
    assert memory_cleared["general"]["embedding"]["dimensions"] == 1536
    assert memory_cleared["overrides"]["memory"]["embedding"]["dimensions"] is None
