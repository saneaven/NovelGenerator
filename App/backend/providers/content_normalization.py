from __future__ import annotations

from dataclasses import dataclass, replace

from .contracts import DeltaPayload, FinalSnapshot


@dataclass
class StreamContentNormalizer:
    has_emitted_content: bool = False

    def normalize_delta(self, payload: DeltaPayload) -> DeltaPayload:
        content_delta = payload.content_delta
        if content_delta is None or self.has_emitted_content:
            return payload

        trimmed = content_delta.lstrip()
        if trimmed:
            self.has_emitted_content = True
            if trimmed == content_delta:
                return payload
            return replace(payload, content_delta=trimmed)

        # Preserve the fact that a content delta was seen so fallback assembly
        # can still finalize an otherwise whitespace-only response.
        return replace(payload, content_delta="")


def has_effective_delta(payload: DeltaPayload) -> bool:
    return bool(
        payload.content_delta
        or payload.thinking_delta
        or payload.tool_call_deltas
        or payload.reasoning_detail_delta
    )


def normalize_final_snapshot_content(snapshot: FinalSnapshot) -> FinalSnapshot:
    parts = snapshot.content_parts or []
    if not parts:
        return snapshot

    first_surviving_idx: int | None = None
    last_surviving_idx: int | None = None

    for idx, part in enumerate(parts):
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str) and text.lstrip():
            first_surviving_idx = idx
            break

    for idx in range(len(parts) - 1, -1, -1):
        part = parts[idx]
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str) and text.rstrip():
            last_surviving_idx = idx
            break

    normalized_parts: list[dict[str, str]] = []
    for idx, part in enumerate(parts):
        if not isinstance(part, dict):
            continue

        if part.get("type") != "content":
            normalized_parts.append(dict(part))
            continue

        text = part.get("text")
        if not isinstance(text, str):
            continue

        if first_surviving_idx is None or last_surviving_idx is None:
            continue
        if idx < first_surviving_idx or idx > last_surviving_idx:
            continue

        next_text = text
        if idx == first_surviving_idx:
            next_text = next_text.lstrip()
        if idx == last_surviving_idx:
            next_text = next_text.rstrip()
        if not next_text:
            continue

        next_part = dict(part)
        next_part["text"] = next_text
        normalized_parts.append(next_part)

    return replace(snapshot, content_parts=normalized_parts)
