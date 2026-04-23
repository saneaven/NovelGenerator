from __future__ import annotations

import asyncio
import copy
import json
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

import httpx

from ..shared.async_openai_provider import AsyncOpenAIProvider
from ..shared.contracts import MetaPayload, ProviderErrorPayload, ProviderEvent
from ...utils.outbound_http import filter_additional_body, merge_user_overrides


NANOGPT_CHAT_COMPLETIONS_URL = "https://nano-gpt.com/api/v1/chat/completions"
NANOGPT_MODELS_URL = "https://nano-gpt.com/api/personalized/v1/models"
NANOGPT_SUBSCRIPTION_MODELS_URL = "https://nano-gpt.com/api/subscription/v1/models"
NANOGPT_PAID_MODELS_URL = "https://nano-gpt.com/api/paid/v1/models"


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None


def _extract_model_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return [item for item in payload.get("data") if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _compute_pricing_display(pricing: Any) -> dict[str, float] | None:
    if not isinstance(pricing, dict):
        return None
    unit = str(pricing.get("unit") or "").strip().lower()
    if unit != "per_million_tokens":
        return None
    out: dict[str, float] = {}
    for key in ("prompt", "completion", "image"):
        raw = pricing.get(key)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        out[f"{key}_per_1m"] = round(value, 6)
    return out or None


async def _safe_fetch_model_catalog(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
) -> list[dict[str, Any]]:
    try:
        response = await client.get(url, headers=headers, params={"detailed": "true"})
        response.raise_for_status()
        return _extract_model_items(response.json())
    except Exception:
        return []

class NanoGPTProvider(AsyncOpenAIProvider):
    @property
    def name(self) -> str:
        return "nanogpt"

    @property
    def display_name(self) -> str:
        return "NanoGPT"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    @property
    def base_url(self) -> str:
        return "https://nano-gpt.com/api/v1"

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        details = self._snapshot_reasoning_details(final_snapshot)
        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None
        data: dict[str, Any] = {
            "reasoning_details": details,
        }
        meta: dict[str, Any] = {"provider": "nanogpt"}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
            meta["thinking_display"] = "reasoning_text"
        return {
            "type": "nanogpt",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"

    async def get_models(self) -> Dict:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            personalized_items, subscription_items, paid_items = await asyncio.gather(
                _safe_fetch_model_catalog(client, url=NANOGPT_MODELS_URL, headers=headers),
                _safe_fetch_model_catalog(client, url=NANOGPT_SUBSCRIPTION_MODELS_URL, headers=headers),
                _safe_fetch_model_catalog(client, url=NANOGPT_PAID_MODELS_URL, headers=headers),
            )

        subscription_ids = {
            str(item.get("id") or "").strip()
            for item in subscription_items
            if str(item.get("id") or "").strip()
        }
        paid_ids = {
            str(item.get("id") or "").strip()
            for item in paid_items
            if str(item.get("id") or "").strip()
        }

        models: list[dict[str, Any]] = []
        for item in personalized_items:
            model_id = str(item.get("id") or "").strip()
            if not model_id:
                continue
            projected = dict(item)
            if model_id in subscription_ids:
                projected["access_tier"] = "subscription"
            elif model_id in paid_ids:
                projected["access_tier"] = "paid"
            pricing_display = _compute_pricing_display(projected.get("pricing"))
            if pricing_display is not None:
                projected["pricing_display"] = pricing_display
            models.append(projected)

        return {"data": models}

    def _build_structured_body_overrides(
        self,
        provider_settings: Optional[Dict[str, Any]],
        *,
        thinking_mode: Optional[str],
        thinking_config: Optional[Dict[str, Any]],
    ) -> dict[str, Any]:
        settings = provider_settings if _is_plain_object(provider_settings) else {}
        extra: dict[str, Any] = {}

        billing = settings.get("billing") if _is_plain_object(settings.get("billing")) else {}
        billing_mode = _string_or_none(billing.get("billing_mode"))
        if billing_mode:
            extra["billing_mode"] = billing_mode
        service_tier = _string_or_none(billing.get("service_tier"))
        if service_tier:
            extra["service_tier"] = service_tier

        web = settings.get("web") if _is_plain_object(settings.get("web")) else {}
        if "enabled" in web and isinstance(web.get("enabled"), bool):
            web_search: dict[str, Any] = {"enabled": bool(web.get("enabled"))}
            provider_name = _string_or_none(web.get("provider"))
            if provider_name:
                web_search["provider"] = provider_name
            depth = _string_or_none(web.get("depth"))
            if depth:
                web_search["depth"] = depth
            search_context_size = _string_or_none(web.get("search_context_size"))
            if search_context_size:
                web_search["search_context_size"] = search_context_size
            user_location = web.get("user_location") if _is_plain_object(web.get("user_location")) else {}
            location_payload = {
                key: value
                for key, value in {
                    "type": "approximate",
                    "country": _string_or_none(user_location.get("country")),
                    "city": _string_or_none(user_location.get("city")),
                    "region": _string_or_none(user_location.get("region")),
                }.items()
                if value
            }
            if len(location_payload) > 1:
                web_search["user_location"] = location_payload
            extra["webSearch"] = web_search

        scraping = settings.get("scraping") if _is_plain_object(settings.get("scraping")) else {}
        if "scraping" in scraping and isinstance(scraping.get("scraping"), bool):
            extra["scraping"] = bool(scraping.get("scraping"))

        youtube = settings.get("youtube") if _is_plain_object(settings.get("youtube")) else {}
        if "youtube_transcripts" in youtube and isinstance(youtube.get("youtube_transcripts"), bool):
            extra["youtube_transcripts"] = bool(youtube.get("youtube_transcripts"))

        memory = settings.get("memory") if _is_plain_object(settings.get("memory")) else {}
        model_context_limit = memory.get("model_context_limit")
        if isinstance(model_context_limit, int) and model_context_limit > 0:
            extra["model_context_limit"] = model_context_limit

        if thinking_mode == "model" and isinstance(thinking_config, dict):
            effort = _string_or_none(thinking_config.get("effort"))
            if effort:
                extra["reasoning_effort"] = effort

        return extra

    def _build_extra_headers(self, provider_settings: Optional[Dict[str, Any]]) -> dict[str, str]:
        settings = provider_settings if _is_plain_object(provider_settings) else {}
        headers: dict[str, str] = {}
        memory = settings.get("memory") if _is_plain_object(settings.get("memory")) else {}
        if "enabled" in memory and isinstance(memory.get("enabled"), bool):
            headers["memory"] = "true" if bool(memory.get("enabled")) else "false"
        expiration_days = memory.get("expiration_days")
        if isinstance(expiration_days, int) and expiration_days > 0:
            headers["memory_expiration_days"] = str(expiration_days)
        return headers

    def _extract_custom_fields(self, provider_settings: Optional[Dict[str, Any]]) -> dict[str, Any]:
        settings = provider_settings if _is_plain_object(provider_settings) else {}
        raw = settings.get("custom_fields")
        return filter_additional_body(raw if isinstance(raw, dict) else {})

    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        if thinking_mode != "model":
            return chunk, []

        choices = chunk.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return chunk, []
        delta = choices[0].get("delta")
        if not isinstance(delta, dict):
            return chunk, []

        reasoning_text_chunks: list[str] = []
        if isinstance(delta.get("reasoning_content"), str):
            reasoning_text_chunks.append(str(delta["reasoning_content"]))
        reasoning_value = delta.get("reasoning")
        if isinstance(reasoning_value, str):
            reasoning_text_chunks.append(reasoning_value)
        elif isinstance(reasoning_value, dict):
            text = reasoning_value.get("text")
            if isinstance(text, str):
                reasoning_text_chunks.append(text)
        if reasoning_text_chunks:
            thinking = delta.setdefault("thinking", {})
            if isinstance(thinking, dict):
                thinking["text"] = "".join(reasoning_text_chunks)

        details = delta.get("reasoning_details")
        if not isinstance(details, list):
            alt_details = choices[0].get("reasoning_details")
            if isinstance(alt_details, list):
                delta["reasoning_details"] = alt_details

        return chunk, []

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None,
        custom_kind: Optional[str] = None,
        native_tool_call: bool = False,
        verbosity: Optional[str] = None,
        provider_settings: Optional[Dict[str, Any]] = None,
        cache_settings: Optional[Dict[str, Any]] = None,
        cache_plan: Any = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        del provider_preference, custom_kind, verbosity
        if not self.validate_config():
            yield ProviderEvent(kind="error", error=ProviderErrorPayload(message="Invalid provider configuration"))
            return

        converted_messages = self._convert_messages(messages)
        base_request = self._prepare_request_kwargs(
            converted_messages,
            model,
            temperature,
            tools,
            tool_choice,
            max_tokens,
            None,
            None,
            thinking_mode,
            None,
        )
        base_body = {
            key: value
            for key, value in base_request.items()
            if key not in {"extra_body", "extra_headers"}
        }
        structured = self._build_structured_body_overrides(
            provider_settings,
            thinking_mode=thinking_mode,
            thinking_config=thinking_config,
        )
        merged_body = merge_user_overrides(base_body, structured)
        custom_fields = self._extract_custom_fields(provider_settings)
        final_body = merge_user_overrides(merged_body, custom_fields)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self._build_extra_headers(provider_settings),
        }

        if isinstance(cache_settings, dict) and bool(cache_settings.get("enabled", False)):
            prompt_caching: dict[str, Any] = {
                "enabled": True,
                "ttl": str(cache_settings.get("ttl") or "5m"),
                "stickyProvider": bool(cache_settings.get("stickyProvider", False)),
            }
            selected_count = int(getattr(cache_plan, "selected_provider_message_count", 0) or 0)
            if selected_count > 0:
                prompt_caching["cut_after_message_index"] = selected_count - 1
            final_body["prompt_caching"] = prompt_caching
            headers["anthropic-beta"] = "prompt-caching-2024-07-31"

        yield ProviderEvent(kind="meta", raw_request={"headers": headers, "json": final_body})

        parser = None
        native_tc_parser = None
        if thinking_mode == "custom":
            from ..shared.parsing.thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag

            has_open_thinking = has_unclosed_thinking_tag(converted_messages)
            parser = ThinkingStreamParser(inside_thinking=has_open_thinking)
        if native_tool_call:
            from ..shared.parsing.native_tool_calls_parser import NativeToolCallsStreamParser

            native_tc_parser = NativeToolCallsStreamParser()

        last_finish_reason = None
        captured_usage: Optional[Dict[str, Any]] = None
        captured_reasoning_tokens: Optional[int] = None
        captured_cache_metrics: Optional[Dict[str, Any]] = None
        raw_accumulated: Dict[str, Any] = {}

        def _update_meta_from_chunk(chunk_dict: Dict[str, Any]) -> None:
            nonlocal captured_usage, captured_reasoning_tokens, last_finish_reason, captured_cache_metrics
            usage = chunk_dict.get("usage")
            if isinstance(usage, dict):
                captured_usage = usage
                prompt_details = usage.get("prompt_tokens_details")
                completion_details = usage.get("completion_tokens_details")
                if isinstance(completion_details, dict):
                    reasoning_tokens = completion_details.get("reasoning_tokens")
                    if isinstance(reasoning_tokens, (int, float)):
                        captured_reasoning_tokens = int(reasoning_tokens)
                elif isinstance(prompt_details, dict):
                    reasoning_tokens = prompt_details.get("reasoning_tokens")
                    if isinstance(reasoning_tokens, (int, float)):
                        captured_reasoning_tokens = int(reasoning_tokens)
                metrics: dict[str, Any] = {}
                if isinstance(prompt_details, dict):
                    cached_tokens = prompt_details.get("cached_tokens")
                    if isinstance(cached_tokens, (int, float)):
                        metrics["cached_tokens"] = int(cached_tokens)
                    cache_read_tokens = prompt_details.get("cache_read_input_tokens")
                    if isinstance(cache_read_tokens, (int, float)):
                        metrics["cache_read_tokens"] = int(cache_read_tokens)
                    cache_write_tokens = prompt_details.get("cache_creation_input_tokens")
                    if isinstance(cache_write_tokens, (int, float)):
                        metrics["cache_write_tokens"] = int(cache_write_tokens)
                if metrics:
                    captured_cache_metrics = metrics
            for choice in chunk_dict.get("choices", []):
                if isinstance(choice, dict) and choice.get("finish_reason") is not None:
                    last_finish_reason = str(choice.get("finish_reason"))

        def _emit_from_chunk(chunk_dict: Dict[str, Any]) -> tuple[list[ProviderEvent], bool]:
            events: list[ProviderEvent] = []
            should_stop = False
            chunk_obj, extra_chunks = self._mutate_chunk(chunk_dict, thinking_mode)
            if parser is not None:
                chunk_obj, parser_chunks = self._apply_thinking_parser(chunk_obj, parser)
                extra_chunks.extend(parser_chunks)
            if native_tc_parser is not None:
                chunk_obj, fc_chunks = self._apply_native_tool_calls_parser(chunk_obj, native_tc_parser)
            else:
                fc_chunks = []

            if chunk_obj and self._has_meaningful_payload(chunk_obj):
                events.extend(self._chunk_to_events(chunk_obj))
            for extra in fc_chunks + extra_chunks:
                if native_tc_parser is not None:
                    extra, extra_fc_chunks = self._apply_native_tool_calls_parser(extra, native_tc_parser)
                else:
                    extra_fc_chunks = []
                if extra and self._has_meaningful_payload(extra):
                    events.extend(self._chunk_to_events(extra))
                for sub in extra_fc_chunks:
                    if self._has_meaningful_payload(sub):
                        events.extend(self._chunk_to_events(sub))
                if native_tc_parser and native_tc_parser.tool_calls_completed:
                    events.append(ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls")))
                    should_stop = True
                    break
            return events, should_stop

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", NANOGPT_CHAT_COMPLETIONS_URL, headers=headers, json=final_body) as response:
                    response.raise_for_status()
                    data_lines: list[str] = []
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            data_lines.append(line[5:].strip())
                            continue
                        if line.strip():
                            continue
                        if not data_lines:
                            continue
                        payload = "\n".join(data_lines).strip()
                        data_lines = []
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            chunk_dict = json.loads(payload)
                        except ValueError:
                            continue
                        if not isinstance(chunk_dict, dict):
                            continue
                        self._accumulate_raw_chunk(raw_accumulated, copy.deepcopy(chunk_dict))
                        _update_meta_from_chunk(chunk_dict)
                        events, should_stop = _emit_from_chunk(chunk_dict)
                        for event in events:
                            yield event
                        if should_stop:
                            return
                    if data_lines:
                        payload = "\n".join(data_lines).strip()
                        if payload and payload != "[DONE]":
                            try:
                                chunk_dict = json.loads(payload)
                            except ValueError:
                                chunk_dict = None
                            if isinstance(chunk_dict, dict):
                                self._accumulate_raw_chunk(raw_accumulated, copy.deepcopy(chunk_dict))
                                _update_meta_from_chunk(chunk_dict)
                                events, should_stop = _emit_from_chunk(chunk_dict)
                                for event in events:
                                    yield event
                                if should_stop:
                                    return
        except httpx.HTTPStatusError as exc:
            message = ""
            try:
                raw_error = await exc.response.aread()
                if raw_error:
                    message = raw_error.decode("utf-8", errors="replace").strip()
            except Exception:
                message = ""
            yield ProviderEvent(kind="error", error=ProviderErrorPayload(message=message or str(exc), status=exc.response.status_code))
            return
        except Exception as exc:  # noqa: BLE001
            yield ProviderEvent(kind="error", error=ProviderErrorPayload(message=str(exc)))
            return

        try:
            if parser is not None:
                for final_chunk in self._finalize_parser(parser):
                    if self._has_meaningful_payload(final_chunk):
                        for event in self._chunk_to_events(final_chunk):
                            yield event
            if native_tc_parser is not None:
                for final_fc_chunk in self._finalize_native_tool_calls_parser(native_tc_parser):
                    if self._has_meaningful_payload(final_fc_chunk):
                        for event in self._chunk_to_events(final_fc_chunk):
                            yield event
                if native_tc_parser.tool_calls_completed:
                    yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))
                    return
        except Exception as exc:  # noqa: BLE001
            yield ProviderEvent(kind="error", error=ProviderErrorPayload(message=str(exc)))
            return

        if captured_usage:
            usage_payload = {
                "prompt_tokens": int(captured_usage.get("prompt_tokens", 0) or 0),
                "completion_tokens": int(captured_usage.get("completion_tokens", 0) or 0),
                "total_tokens": int(captured_usage.get("total_tokens", 0) or 0),
            }
            prompt_details = captured_usage.get("prompt_tokens_details")
            completion_details = captured_usage.get("completion_tokens_details")
            if isinstance(prompt_details, dict):
                usage_payload["prompt_tokens_details"] = prompt_details
            if isinstance(completion_details, dict):
                usage_payload["completion_tokens_details"] = completion_details
            yield ProviderEvent(
                kind="meta",
                meta=MetaPayload(
                    usage=usage_payload,
                    finish_reason=last_finish_reason,
                    reasoning_tokens=captured_reasoning_tokens,
                    cache_metrics=captured_cache_metrics,
                ),
                raw_response=raw_accumulated or None,
            )


def create_provider(*, provider_config: Dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return NanoGPTProvider(provider_config)
