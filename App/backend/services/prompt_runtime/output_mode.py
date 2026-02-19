from __future__ import annotations

from typing import Any


VALID_OUTPUT_MODES = {"tool_call", "native_tool_call", "raw_output"}
FORCED_RAW_JOURNEY_KINDS = {"imagePrompt", "sceneImagePrompt", "messageTranslation"}


def resolve_output_mode(
    *,
    journey_kind: str | None,
    payload: dict[str, Any] | None,
    native_output_mode: bool,
) -> str:
    kind = str(journey_kind or "").strip()
    if kind in FORCED_RAW_JOURNEY_KINDS:
        return "raw_output"

    data = payload if isinstance(payload, dict) else {}
    explicit_mode = str(data.get("outputMode") or "").strip()
    if explicit_mode in VALID_OUTPUT_MODES:
        return explicit_mode

    if bool(data.get("rawMode")):
        return "raw_output"

    if native_output_mode:
        return "native_tool_call"

    return "tool_call"

