from __future__ import annotations

from typing import Any, Iterable

from .template_renderer import TemplateRenderer


def _collapse_content_text(parts: Any) -> str:
    if not isinstance(parts, list):
        return ""
    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str):
            chunks.append(text)
    return "".join(chunks)


def _normalize_index(i: int, n: int) -> int | None:
    if n <= 0:
        return None
    if i >= 0:
        norm = i
    else:
        norm = n + i
    if norm < 0 or norm >= n:
        return None
    return int(norm)


def _iter_blocks_in_order(blocks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    items = [b for b in blocks if isinstance(b, dict)]
    # Server should normalize block_order, but be defensive.
    items.sort(key=lambda b: int(b.get("block_order") or 0))
    return items


def _shallow_copy_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _patched_template_data(*, template_data: dict[str, Any], input_key: str, source_text: str) -> dict[str, Any]:
    root = _shallow_copy_dict(template_data)
    inp = _shallow_copy_dict(root.get("input"))
    inp[input_key] = source_text
    root["input"] = inp
    return root


def assemble_scenario(
    *,
    template_renderer: TemplateRenderer,
    task_type: str,
    system_template: str,
    blocks: list[dict[str, Any]],
    source_conversation: list[dict[str, Any]],
    template_data: dict[str, Any],
) -> tuple[str, list[dict[str, Any]], str | None, str | None]:
    """Assemble a scenario into (system_prompt, conversation, prefill, memory_template).

    - Indexing targets only role=user|assistant from source_conversation.
    - tool_results are attached to the preceding assistant turn and are appended only when that assistant is emitted.
    - Overlapping rangeMapping blocks resolve by owner overwrite (later blocks win).
    - prefill is returned as rendered text; memory_template is returned as the raw template text (rendered later with memory data).
    """
    blocks_in_order = _iter_blocks_in_order(blocks)

    # 1) Build source sequence (user/assistant only) and attach tool_results to assistants.
    source_items: list[dict[str, Any]] = []
    idx = 0
    while idx < len(source_conversation):
        msg = source_conversation[idx]
        role = msg.get("role") if isinstance(msg, dict) else None
        if role not in {"user", "assistant"}:
            idx += 1
            continue

        entry: dict[str, Any] = {"message": msg, "tool_results": []}
        if role == "assistant":
            attached: list[dict[str, Any]] = []
            j = idx + 1
            while j < len(source_conversation):
                nxt = source_conversation[j]
                if not isinstance(nxt, dict) or nxt.get("role") != "tool_results":
                    break
                attached.append(nxt)
                j += 1
            entry["tool_results"] = attached
            idx = j
        else:
            idx += 1

        source_items.append(entry)

    n_sources = len(source_items)

    # 2) Compute owner map (later range blocks win).
    owner: dict[int, int] = {}
    for block in blocks_in_order:
        if not bool(block.get("enabled", True)):
            continue
        if block.get("type") != "rangeMapping":
            continue
        mapping = block.get("rangeMapping")
        if not isinstance(mapping, dict):
            continue
        try:
            start_i = int(mapping.get("start_index"))
            end_i = int(mapping.get("end_index"))
        except (TypeError, ValueError):
            continue

        start_norm = _normalize_index(start_i, n_sources)
        end_norm = _normalize_index(end_i, n_sources)
        if start_norm is None or end_norm is None:
            continue
        if start_norm > end_norm:
            continue

        block_order = int(block.get("block_order") or 0)
        for si in range(start_norm, end_norm + 1):
            owner[si] = block_order

    # 3) Render system prompt.
    rendered_system_prompt = template_renderer.render_text(system_template or "", template_data).strip()

    rendered_conversation: list[dict[str, Any]] = []
    prefill: str | None = None
    memory_template: str | None = None

    # Patch rules differ for subAgent.
    is_sub_agent = str(task_type or "") == "subAgent"
    user_input_key = "agentMessage" if is_sub_agent else "userMessage"
    assistant_input_key = "subAgentMessage" if is_sub_agent else "agentMessage"

    for block in blocks_in_order:
        if not bool(block.get("enabled", True)):
            continue

        btype = block.get("type")

        if btype == "staticPrompt":
            static = block.get("staticPrompt")
            if not isinstance(static, dict):
                continue
            subtype = str(static.get("subtype") or "normal")
            role = static.get("role")
            template_text = static.get("template")
            if not isinstance(role, str) or role not in {"user", "assistant"}:
                continue
            if not isinstance(template_text, str):
                template_text = ""

            if subtype == "memory":
                memory_template = template_text.strip() or None
                continue
            if subtype == "prefill":
                rendered = template_renderer.render_text(template_text, template_data).strip()
                prefill = rendered or None
                continue
            rendered = template_renderer.render_text(template_text, template_data).strip()
            if not rendered:
                continue

            rendered_conversation.append(
                {
                    "role": role,
                    "content_parts": [{"type": "content", "text": rendered}],
                }
            )
            continue

        if btype != "rangeMapping":
            continue

        mapping = block.get("rangeMapping")
        if not isinstance(mapping, dict):
            continue

        try:
            start_i = int(mapping.get("start_index"))
            end_i = int(mapping.get("end_index"))
        except (TypeError, ValueError):
            continue

        start_norm = _normalize_index(start_i, n_sources)
        end_norm = _normalize_index(end_i, n_sources)
        if start_norm is None or end_norm is None:
            continue
        if start_norm > end_norm:
            continue

        block_order = int(block.get("block_order") or 0)
        user_template = mapping.get("user_template") if isinstance(mapping.get("user_template"), str) else ""
        assistant_template = (
            mapping.get("assistant_template") if isinstance(mapping.get("assistant_template"), str) else ""
        )

        for source_index in range(start_norm, end_norm + 1):
            if owner.get(source_index) != block_order:
                continue

            src_entry = source_items[source_index]
            src_msg = src_entry.get("message")
            if not isinstance(src_msg, dict):
                continue
            src_role = src_msg.get("role")
            if src_role not in {"user", "assistant"}:
                continue

            src_text = _collapse_content_text(src_msg.get("content_parts"))

            if src_role == "user":
                patched = _patched_template_data(
                    template_data=template_data,
                    input_key=user_input_key,
                    source_text=src_text,
                )
                rendered = template_renderer.render_text(user_template, patched).strip()
                if not rendered:
                    continue
                out_msg: dict[str, Any] = {
                    "role": "user",
                    "content_parts": [{"type": "content", "text": rendered}],
                }
                run_id = src_msg.get("run_id")
                if isinstance(run_id, str) and run_id:
                    out_msg["run_id"] = run_id
                seq_in_thread = src_msg.get("seq_in_thread")
                if isinstance(seq_in_thread, int):
                    out_msg["seq_in_thread"] = seq_in_thread
                rendered_conversation.append(out_msg)
                continue

            patched = _patched_template_data(
                template_data=template_data,
                input_key=assistant_input_key,
                source_text=src_text,
            )
            rendered = template_renderer.render_text(assistant_template, patched).strip()
            if not rendered:
                continue

            out_msg = {
                "role": "assistant",
                "content_parts": [{"type": "content", "text": rendered}],
            }

            run_id = src_msg.get("run_id")
            if isinstance(run_id, str) and run_id:
                out_msg["run_id"] = run_id
            seq_in_thread = src_msg.get("seq_in_thread")
            if isinstance(seq_in_thread, int):
                out_msg["seq_in_thread"] = seq_in_thread

            tool_calls = src_msg.get("tool_calls")
            if isinstance(tool_calls, list) and tool_calls:
                out_msg["tool_calls"] = tool_calls

            reasoning_detail = src_msg.get("reasoning_detail")
            if isinstance(reasoning_detail, dict) and reasoning_detail:
                out_msg["reasoning_detail"] = reasoning_detail

            rendered_conversation.append(out_msg)

            attached = src_entry.get("tool_results")
            if isinstance(attached, list) and attached:
                for tool_msg in attached:
                    if isinstance(tool_msg, dict):
                        rendered_conversation.append(dict(tool_msg))

    return rendered_system_prompt, rendered_conversation, prefill, memory_template
