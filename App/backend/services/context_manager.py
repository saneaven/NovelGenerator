from __future__ import annotations

from typing import Awaitable, Callable


class ContextOverflowError(RuntimeError):
    pass


async def _count_tokens_fallback(text: str) -> int:
    # conservative approximation when tokenizer API is unavailable.
    return max(1, len(text) // 4)


def _conversation_to_text(system_prompt: str, conversation: list[dict], prefill: str | None) -> str:
    chunks: list[str] = []
    if system_prompt:
        chunks.append(system_prompt)
    for msg in conversation:
        parts = msg.get("content_parts") if isinstance(msg, dict) else None
        if isinstance(parts, list):
            chunks.extend(str(p.get("text") or "") for p in parts if isinstance(p, dict))
        tool_results = msg.get("tool_results") if isinstance(msg, dict) else None
        if isinstance(tool_results, list):
            chunks.extend(str(tr.get("content") or "") for tr in tool_results if isinstance(tr, dict))
    if prefill:
        chunks.append(prefill)
    return "\n".join(chunks)


async def fit_to_context_window(
    system_prompt: str,
    conversation: list[dict],
    prefill: str | None,
    context_window_tokens: int,
    rebuild_memory_cb: Callable[[list[dict]], Awaitable[tuple[list[dict], str | None]]] | None = None,
    count_tokens_cb: Callable[[str], Awaitable[int]] | None = None,
) -> tuple[list[dict], str | None]:
    if context_window_tokens <= 0:
        return conversation, None

    counter = count_tokens_cb or _count_tokens_fallback
    memory_prompt: str | None = None
    current = list(conversation)

    for _ in range(8):
        serialized = _conversation_to_text(system_prompt, current, prefill)
        total_tokens = await counter(serialized)
        if total_tokens <= context_window_tokens:
            return current, memory_prompt

        # Drop oldest half while preserving the latest context.
        if len(current) <= 1:
            raise ContextOverflowError(
                f"Context too large even after aggressive trimming (tokens={total_tokens}, limit={context_window_tokens})"
            )

        cut_idx = max(1, len(current) // 2)
        current = current[cut_idx:]

        if rebuild_memory_cb is not None:
            rebuilt_conversation, rebuilt_memory = await rebuild_memory_cb(current)
            current = rebuilt_conversation
            memory_prompt = rebuilt_memory

    raise ContextOverflowError("Context overflow: max trimming iterations exceeded")
