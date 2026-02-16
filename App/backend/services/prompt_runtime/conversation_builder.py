from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ...services.template_engine import create_environment, render_template
from ..history_service import HistoryMessage
from .prompt_manager import PromptBundle


@dataclass
class ConversationBuildOptions:
    tool_call_history_limit: int
    thinking_history_limit: int
    include_prefill: bool = False


class ConversationBuilder:
    @staticmethod
    def _message_text(parts: list[dict[str, Any]]) -> str:
        return "".join(str(p.get("text") or "") for p in parts if p.get("type") == "content")

    def build_conversation_blocks(
        self,
        history: list[HistoryMessage],
        prompt_bundle: PromptBundle,
        opts: ConversationBuildOptions,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        env = create_environment(fragment_map=prompt_bundle.fragment_map)

        messages.append(
            {
                "role": "system",
                "content_parts": [{"type": "content", "text": prompt_bundle.system_prompt}],
            }
        )

        has_memory = bool(prompt_bundle.memory_prompt.strip())
        if has_memory:
            messages.append(
                {
                    "role": "user",
                    "content_parts": [{"type": "content", "text": prompt_bundle.memory_prompt}],
                }
            )

        assistant_indices = [i for i, m in enumerate(history) if m.role == "assistant"]
        total_assistants = len(assistant_indices)

        user_indices = [i for i, m in enumerate(history) if m.role == "user"]
        total_users = len(user_indices)
        first_user = user_indices[0] if user_indices else -1
        last_user = user_indices[-1] if user_indices else -1

        assistant_count = 0
        for idx, msg in enumerate(history):
            if msg.role == "user":
                if total_users == 1:
                    template = prompt_bundle.single_user_prompt
                elif idx == first_user and prompt_bundle.first_user_prompt is not None:
                    template = prompt_bundle.first_user_prompt
                elif idx == last_user and prompt_bundle.last_user_prompt is not None:
                    template = prompt_bundle.last_user_prompt
                else:
                    template = prompt_bundle.user_prompt

                injected_key = prompt_bundle.message_input_key
                injected_text = self._message_text(msg.content_parts)
                rendered = render_template(
                    env,
                    template,
                    {
                        **prompt_bundle.template_data,
                        "input": {
                            **(prompt_bundle.template_data.get("input") or {}),
                            injected_key: injected_text,
                        },
                    },
                )
                messages.append(
                    {
                        "role": "user",
                        "content_parts": [{"type": "content", "text": rendered}],
                    }
                )
                continue

            if msg.role == "assistant":
                assistant_count += 1
                include_tool_calls = (
                    opts.tool_call_history_limit == -1
                    or (opts.tool_call_history_limit > 0 and assistant_count > total_assistants - opts.tool_call_history_limit)
                )
                include_thinking = (
                    opts.thinking_history_limit == -1
                    or (opts.thinking_history_limit > 0 and assistant_count > total_assistants - opts.thinking_history_limit)
                )

                content_parts = msg.content_parts
                if not include_thinking:
                    content_parts = [p for p in content_parts if p.get("type") != "thinking"]
                if not content_parts:
                    content_parts = [{"type": "content", "text": ""}]

                block: dict[str, Any] = {
                    "role": "assistant",
                    "content_parts": content_parts,
                }
                if include_tool_calls and msg.tool_calls:
                    block["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.tool_name,
                                "arguments": tc.arguments if isinstance(tc.arguments, str) else tc.arguments,
                            },
                        }
                        for tc in msg.tool_calls
                    ]
                messages.append(block)

                # tool results as a dedicated block
                if msg.tool_calls:
                    tool_results = []
                    for tc in msg.tool_calls:
                        if tc.status in {"pending", "running"}:
                            continue
                        if tc.status == "accepted":
                            content = (
                                str((tc.result or {}).get("message"))
                                if isinstance(tc.result, dict)
                                else "Applied successfully"
                            )
                        elif tc.status == "rejected":
                            content = f"User rejected: {tc.reason}" if tc.reason else "User rejected this action"
                        elif tc.status == "cancelled":
                            content = f"Cancelled: {tc.reason}" if tc.reason else "Cancelled"
                        else:
                            content = f"Failed: {tc.reason or 'Unknown error'}"
                        tool_results.append(
                            {
                                "tool_call_id": tc.id,
                                "tool_name": tc.tool_name,
                                "content": content,
                            }
                        )
                    if tool_results:
                        messages.append({"role": "tool_results", "content_parts": [], "tool_results": tool_results})
                continue

            # pass-through for system/tool role stored in run history
            messages.append(
                {
                    "role": "tool_results" if msg.role == "tool" else msg.role,
                    "content_parts": msg.content_parts or [{"type": "content", "text": ""}],
                }
            )

        if opts.include_prefill and prompt_bundle.prefill:
            messages.append(
                {
                    "role": "assistant",
                    "content_parts": [{"type": "content", "text": prompt_bundle.prefill}],
                }
            )

        return messages


conversation_builder = ConversationBuilder()
