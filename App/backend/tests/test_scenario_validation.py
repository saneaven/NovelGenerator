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
