from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from ..providers.registry import ProviderRegistry
from ..providers.openrouter import OpenRouterProvider  # noqa: F401
from ..providers.custom import CustomProvider  # noqa: F401
from ..providers.claude_provider import ClaudeProvider  # noqa: F401
from ..providers.gemini_provider import GeminiProvider  # noqa: F401
from ..providers.openai_responses_provider import OpenAIResponsesProvider  # noqa: F401
from ..providers.xai_provider import XAIProvider  # noqa: F401
from ..providers.contracts import (
    DeltaPayload,
    FinalSnapshot,
    MetaPayload,
    ProviderErrorPayload,
    extract_native_tool_calls_from_snapshot,
    merge_meta_payload,
    patch_snapshot_with_meta,
)
from ..providers.fallback_snapshot_assembler import FallbackSnapshotAssembler


DeltaCallback = Callable[[DeltaPayload], Any | Awaitable[Any]]


@dataclass
class StreamAndCollectResult:
    snapshot: FinalSnapshot


class LLMClient:
    async def stream_and_collect(
        self,
        *,
        provider: str,
        provider_config: dict[str, Any],
        model: str,
        messages: list[dict[str, Any]],
        temperature: float,
        tools: list[dict[str, Any]] | None,
        max_tokens: int | None,
        thinking_mode: str | None,
        thinking_config: dict[str, Any] | None,
        thinking_format: str | None,
        request_format: str | None,
        provider_preference: dict[str, Any] | None,
        tool_choice: str | None,
        retry_config: dict[str, Any] | None,
        native_tool_call: bool,
        on_delta: DeltaCallback | None = None,
    ) -> StreamAndCollectResult:
        instance = ProviderRegistry.get_provider(provider, provider_config)
        if not instance.validate_config():
            raise ValueError(f"Invalid configuration for provider '{provider}'")

        stream = instance.stream_chat(
            messages=messages,
            model=model,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=thinking_config,
            thinking_mode=thinking_mode,
            thinking_format=thinking_format,
            request_format=request_format,
            retry_config=retry_config,
            native_tool_call=native_tool_call,
        )

        native_final: FinalSnapshot | None = None
        merged_meta: MetaPayload | None = None
        assembler = FallbackSnapshotAssembler(provider=provider, model=model)

        try:
            async for event in stream:
                if event.kind == "delta" and event.delta is not None:
                    assembler.apply_delta(event.delta)
                    if on_delta is not None:
                        maybe = on_delta(event.delta)
                        if inspect.isawaitable(maybe):
                            await maybe
                    continue

                if event.kind == "meta" and event.meta is not None:
                    assembler.apply_meta(event.meta)
                    merged_meta = merge_meta_payload(merged_meta, event.meta)
                    continue

                if event.kind == "final_native" and event.final_native is not None:
                    if native_final is not None:
                        raise ValueError("Provider emitted multiple native final snapshots")
                    native_final = event.final_native
                    continue

                if event.kind == "error":
                    err = event.error or ProviderErrorPayload(message="Unknown provider error", status=None)
                    raise RuntimeError(err.message)
        finally:
            if hasattr(stream, "aclose"):
                await stream.aclose()

        if native_final is not None:
            snapshot = patch_snapshot_with_meta(native_final, merged_meta)
        else:
            snapshot = assembler.finalize_or_raise()

        if native_tool_call:
            snapshot = extract_native_tool_calls_from_snapshot(snapshot)

        return StreamAndCollectResult(snapshot=snapshot)

    async def call_buffered(self, **kwargs: Any) -> FinalSnapshot:
        result = await self.stream_and_collect(**kwargs)
        return result.snapshot


llm_client = LLMClient()
