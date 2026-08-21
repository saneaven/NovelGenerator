from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ...providers.registry import create_llm_provider
from ...providers.shared.contracts import ProviderErrorPayload, merge_meta_payload, patch_snapshot_with_meta, MetaPayload
from ...providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ...providers.shared.transport.stream_retry import NormalizedRetryConfig, stream_with_retry
from ..llm_runtime_service import LLMRuntime
from ..prompt_runtime.scenario_runtime import assemble_scenario
from ..prompt_runtime.template_renderer import TemplateRenderer
from .errors import SummaryGenerationFailed


def build_memory_summary_template_data(
    *,
    project_data: dict[str, Any],
    language: str,
    previous_summary: str,
    archive_until_message_id: str,
    messages: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "config": {
            "mainLanguage": language,
            "today": datetime.now(timezone.utc).date().isoformat(),
            "thinking_mode": "off",
            "outputMode": "tool_call",
        },
        "project": project_data,
        "input": {
            "userMessage": "",
            "agentMessage": "",
            "subAgentMessage": "",
            "toolResults": [],
        },
        "agent": {
            "runMode": "agentMode",
            "surface": "story-entity",
            "contextObjectIds": [],
        },
        "journey": {
            "kind": "",
            "payload": {},
            "targetIds": [],
        },
        "editAssistant": {
            "manuscript": {
                "currentId": "",
                "currentChapterId": "",
                "currentChapterName": "",
                "currentChapterManuscript": "",
                "contextIds": [],
            },
            "projectData": {
                "contextIds": [],
                "editScope": "selected",
                "basicInfo": None,
                "guidelines": None,
                "storyEntity": None,
            },
            "outline": {
                "contextIds": [],
                "editScope": "selected",
                "outlines": [],
                "acts": [],
                "chapters": [],
            },
        },
        "translation": {
            "sourceLanguage": "",
            "targetLanguage": "",
            "objectIds": [],
            "contextObjectIds": [],
            "currentTranslatedContents": [],
            "messages": [],
        },
        "imagePrompt": {
            "promptFormat": "natural",
            "currentTarget": {
                "basicInfo": None,
                "storyEntity": None,
            },
            "scenePreContext": "",
            "scenePostContext": "",
            "selectedContextIds": [],
        },
        "memory": {
            "summaries": [],
            "historyChats": [],
        },
        "memorySummary": {
            "previousSummary": str(previous_summary or ""),
            "messages": messages if isinstance(messages, list) else [],
            "language": str(language or "English"),
            "archiveUntilMessageId": str(archive_until_message_id or ""),
        },
        "variables": variables if isinstance(variables, dict) else {},
    }


def _collapse_content(parts: Any) -> str:
    if not isinstance(parts, list):
        return ""
    return "".join(
        str(part.get("text") or "")
        for part in parts
        if isinstance(part, dict) and str(part.get("type") or "") == "content"
    ).strip()


def render_summary_prompt(
    *,
    template_renderer: TemplateRenderer,
    summary_scenario: dict[str, Any],
    project_data: dict[str, Any],
    language: str,
    previous_summary: str,
    archive_until_message_id: str,
    messages: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[str, str]:
    template_data = build_memory_summary_template_data(
        project_data=project_data,
        language=language,
        previous_summary=previous_summary,
        archive_until_message_id=archive_until_message_id,
        messages=messages,
        variables=variables,
    )

    system_template = str(summary_scenario.get("system_template") or "")
    blocks = summary_scenario.get("blocks") if isinstance(summary_scenario.get("blocks"), list) else []

    system_prompt, conversation = assemble_scenario(
        template_renderer=template_renderer,
        task_type="memory",
        system_template=system_template,
        blocks=blocks,
        source_conversation=[],
        template_data=template_data,
    )

    user_prompt = ""
    for item in conversation:
        if isinstance(item, dict) and item.get("role") == "user":
            user_prompt = _collapse_content(item.get("content_parts"))
            break

    return system_prompt, user_prompt


async def summarize(
    *,
    slice_payload: dict[str, Any],
    previous_summary: str,
    project_data: dict[str, Any],
    language: str,
    template_renderer: TemplateRenderer,
    summary_scenario: dict[str, Any],
    variables: dict[str, Any] | None,
    runtime: LLMRuntime,
    retry_cfg: NormalizedRetryConfig | None,
) -> str:
    system_prompt, user_prompt = render_summary_prompt(
        template_renderer=template_renderer,
        summary_scenario=summary_scenario,
        project_data=project_data,
        language=language,
        previous_summary=previous_summary,
        archive_until_message_id=str(slice_payload.get("boundary_message_id") or ""),
        messages=list(slice_payload.get("summary_messages") or []),
        variables=variables,
    )
    if not user_prompt.strip():
        raise SummaryGenerationFailed("Summary prompt rendered empty user content")

    provider = create_llm_provider(
        runtime.task_config.provider,
        runtime.provider_config,
        task_config=runtime.task_config.__dict__,
    )
    try:
        if not provider.validate_config():
            raise SummaryGenerationFailed(f"Invalid summary provider configuration: {runtime.task_config.provider}")

        def _create_stream():
            return provider.stream_chat(
                messages=[
                    {"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]},
                    {"role": "user", "content_parts": [{"type": "content", "text": user_prompt}]},
                ],
                model=runtime.task_config.model,
                temperature=float(runtime.task_config.temperature),
                tools=None,
                tool_choice=None,
                max_tokens=runtime.task_config.max_output_tokens,
                provider_preference=getattr(runtime.task_config, "provider_preference", None),
                thinking_config=(
                    runtime.task_config.advanced.get("thinking_config")
                    if isinstance(runtime.task_config.advanced, dict)
                    else None
                ),
                thinking_mode=(
                    runtime.task_config.advanced.get("thinking_mode")
                    if isinstance(runtime.task_config.advanced, dict)
                    else "off"
                ),
                custom_kind=(
                    runtime.task_config.advanced.get("custom_kind")
                    if isinstance(runtime.task_config.advanced, dict)
                    else None
                ),
                native_tool_call=False,
            )

        stream = stream_with_retry(_create_stream, retry_cfg)
        assembler = FallbackSnapshotAssembler(provider=runtime.task_config.provider, model=runtime.task_config.model)
        native_final = None
        merged_meta: MetaPayload | None = None

        try:
            async for event in stream:
                if event.kind == "delta" and event.delta is not None:
                    assembler.apply_delta(event.delta)
                elif event.kind == "meta" and event.meta is not None:
                    assembler.apply_meta(event.meta)
                    merged_meta = merge_meta_payload(merged_meta, event.meta)
                elif event.kind == "final_native" and event.final_native is not None:
                    native_final = event.final_native
                elif event.kind == "error":
                    err = event.error or ProviderErrorPayload(message="Unknown provider error", status=None)
                    raise SummaryGenerationFailed(err.message)
        finally:
            if hasattr(stream, "aclose"):
                await stream.aclose()

        if native_final is not None:
            final_snapshot = patch_snapshot_with_meta(native_final, merged_meta)
        else:
            final_snapshot = assembler.finalize_or_raise()

        summary_text = _collapse_content(final_snapshot.content_parts)
        if not summary_text:
            raise SummaryGenerationFailed("Summary model returned empty content")
        return summary_text
    except SummaryGenerationFailed:
        raise
    except Exception as exc:
        raise SummaryGenerationFailed(str(exc) or "Summary generation failed") from exc
    finally:
        try:
            await provider.aclose()
        except Exception:
            pass
