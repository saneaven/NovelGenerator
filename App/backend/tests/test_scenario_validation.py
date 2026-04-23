from __future__ import annotations

import pytest

from App.backend.services.prompt_runtime.scenario_validation import normalize_and_validate_scenario


def test_static_prompt_subtype_field_is_rejected() -> None:
    with pytest.raises(ValueError, match="INVALID_SCENARIO::invalid_static_prompt_field"):
        normalize_and_validate_scenario(
            {
                "system_template": "",
                "blocks": [
                    {
                        "id": "memory-block",
                        "enabled": True,
                        "type": "staticPrompt",
                        "staticPrompt": {
                            "subtype": "normal",
                            "role": "user",
                            "template": "{{ memory.summaries }}",
                        },
                    }
                ],
            }
        )


def test_cache_point_is_normalized_and_warns_when_consecutive() -> None:
    normalized, warnings = normalize_and_validate_scenario(
        {
            "system_template": "sys",
            "blocks": [
                {"id": "cp-1", "enabled": True, "type": "cachePoint", "cachePoint": {}},
                {"id": "cp-2", "enabled": True, "type": "cachePoint", "cachePoint": {}},
            ],
        }
    )

    assert [block["type"] for block in normalized["blocks"]] == ["cachePoint", "cachePoint"]
    assert warnings == ["CACHE_POINT_CONSECUTIVE::block_id=cp-2"]
