from __future__ import annotations

from typing import Any


ALLOWED_BLOCK_TYPES = {"staticPrompt", "rangeMapping"}
ALLOWED_STATIC_ROLES = {"user", "assistant"}
ALLOWED_STATIC_SUBTYPES = {"normal", "memory"}


def _coerce_int_strict(value: Any, *, field_name: str) -> int:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"INVALID_INT::{field_name}")
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f"INVALID_INT::{field_name}")
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if raw == "":
            raise ValueError(f"INVALID_INT::{field_name}")
        try:
            return int(raw)
        except ValueError as exc:
            raise ValueError(f"INVALID_INT::{field_name}") from exc
    raise ValueError(f"INVALID_INT::{field_name}")


def normalize_and_validate_scenario(scenario: Any) -> tuple[dict[str, Any], list[str]]:
    """Validate ScenarioDocument and normalize block_order based on array order.

    Raises ValueError on hard validation errors.
    Returns (normalized_scenario, warnings).
    """
    if not isinstance(scenario, dict):
        raise ValueError("INVALID_SCENARIO::root_not_object")

    system_template = scenario.get("system_template")
    if not isinstance(system_template, str):
        raise ValueError("INVALID_SCENARIO::system_template_required")

    blocks = scenario.get("blocks")
    if not isinstance(blocks, list):
        raise ValueError("INVALID_SCENARIO::blocks_required")

    warnings: list[str] = []
    memory_blocks = 0

    normalized_blocks: list[dict[str, Any]] = []
    for order, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise ValueError("INVALID_SCENARIO::block_not_object")

        block_id = block.get("id")
        if not isinstance(block_id, str) or not block_id.strip():
            raise ValueError("INVALID_SCENARIO::block_id_required")

        enabled = block.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError(f"INVALID_SCENARIO::enabled_required::block_id={block_id}")

        btype = block.get("type")
        if not isinstance(btype, str) or btype not in ALLOWED_BLOCK_TYPES:
            raise ValueError(f"INVALID_SCENARIO::invalid_block_type::block_id={block_id}")

        if btype == "staticPrompt":
            sp = block.get("staticPrompt")
            if not isinstance(sp, dict):
                raise ValueError(f"INVALID_SCENARIO::staticPrompt_required::block_id={block_id}")

            subtype = sp.get("subtype")
            if not isinstance(subtype, str) or subtype not in ALLOWED_STATIC_SUBTYPES:
                raise ValueError(f"INVALID_SCENARIO::invalid_static_subtype::block_id={block_id}")

            role = sp.get("role")
            if not isinstance(role, str) or role not in ALLOWED_STATIC_ROLES:
                raise ValueError(f"INVALID_SCENARIO::invalid_static_role::block_id={block_id}")

            template = sp.get("template")
            if not isinstance(template, str):
                raise ValueError(f"INVALID_SCENARIO::static_template_required::block_id={block_id}")

            if subtype == "memory":
                memory_blocks += 1
                if memory_blocks > 1:
                    raise ValueError("INVALID_SCENARIO::multiple_memory_blocks")
                if role != "user":
                    raise ValueError("INVALID_SCENARIO::memory_role_must_be_user")

            normalized_blocks.append(
                {
                    "id": block_id,
                    "block_order": int(order),
                    "enabled": enabled,
                    "type": "staticPrompt",
                    "staticPrompt": {
                        "subtype": subtype,
                        "role": role,
                        "template": template,
                    },
                }
            )
            continue

        rm = block.get("rangeMapping")
        if not isinstance(rm, dict):
            raise ValueError(f"INVALID_SCENARIO::rangeMapping_required::block_id={block_id}")

        start_index = _coerce_int_strict(rm.get("start_index"), field_name="start_index")
        end_index = _coerce_int_strict(rm.get("end_index"), field_name="end_index")

        user_template = rm.get("user_template")
        if not isinstance(user_template, str):
            raise ValueError(f"INVALID_SCENARIO::user_template_required::block_id={block_id}")
        assistant_template = rm.get("assistant_template")
        if not isinstance(assistant_template, str):
            raise ValueError(f"INVALID_SCENARIO::assistant_template_required::block_id={block_id}")

        if enabled and not user_template.strip() and not assistant_template.strip():
            warnings.append(f"RANGE_TEMPLATES_EMPTY::block_id={block_id}")

        normalized_blocks.append(
            {
                "id": block_id,
                "block_order": int(order),
                "enabled": enabled,
                "type": "rangeMapping",
                "rangeMapping": {
                    "start_index": int(start_index),
                    "end_index": int(end_index),
                    "user_template": user_template,
                    "assistant_template": assistant_template,
                },
            }
        )

    normalized = {
        "system_template": system_template,
        "blocks": normalized_blocks,
    }
    return normalized, warnings

