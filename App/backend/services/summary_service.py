"""LLM-based rolling memory summary service.

Replaces the old text-truncation _build_archive_summary() from run_context_builder.py
with proper LLM-driven summarisation using the memorySummary prompt templates.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .llm_client import llm_client
from .settings_service import settings_service
from .template_engine import create_environment, render_template

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "prompts" / "templates"
_SYSTEM_TEMPLATE_PATH = _TEMPLATES_DIR / "agent" / "memorySummary" / "systemPrompt.md"
_USER_TEMPLATE_PATH = _TEMPLATES_DIR / "agent" / "memorySummary" / "userPrompt.md"


@dataclass
class SummaryMessage:
    """A message to feed into the summary LLM call."""

    message_id: str
    role: str
    content: str
    created_at: str  # ISO 8601


class SummaryService:
    """Generate rolling memory summaries via LLM using the memorySummary templates."""

    def __init__(self) -> None:
        self._system_template: str | None = None
        self._user_template: str | None = None

    def _load_templates(self) -> tuple[str, str]:
        if self._system_template is None:
            self._system_template = _SYSTEM_TEMPLATE_PATH.read_text(encoding="utf-8")
        if self._user_template is None:
            self._user_template = _USER_TEMPLATE_PATH.read_text(encoding="utf-8")
        return self._system_template, self._user_template

    async def generate_summary(
        self,
        db: Session,
        user_id: UUID,
        *,
        language: str,
        previous_summary: str | None,
        messages: list[SummaryMessage],
    ) -> str:
        """Generate an updated rolling summary from previous summary + new messages.

        Returns the summary text produced by the LLM.
        If *messages* is empty the existing summary is returned unchanged.
        """
        if not messages:
            return previous_summary or ""

        system_tpl, user_tpl = self._load_templates()
        env = create_environment()

        template_data: dict[str, Any] = {
            "memorySummary": {
                "language": language,
                "previousSummary": previous_summary or "(No previous summary)",
                "archiveUntilMessageId": messages[-1].message_id,
                "messages": [
                    {
                        "messageId": m.message_id,
                        "role": m.role,
                        "content": m.content,
                        "createdAt": m.created_at,
                    }
                    for m in messages
                ],
            }
        }

        system_prompt = render_template(env, system_tpl, template_data)
        user_prompt = render_template(env, user_tpl, template_data)

        task_cfg = settings_service.get_task_config(db, user_id, "summary")
        advanced = task_cfg.advanced if isinstance(task_cfg.advanced, dict) else {}

        result = await llm_client.stream_and_collect(
            provider=task_cfg.provider,
            provider_config={},
            model=task_cfg.model,
            messages=[
                {
                    "role": "system",
                    "content_parts": [{"type": "content", "text": system_prompt}],
                },
                {
                    "role": "user",
                    "content_parts": [{"type": "content", "text": user_prompt}],
                },
            ],
            temperature=task_cfg.temperature,
            tools=None,
            max_tokens=task_cfg.max_output_tokens,
            thinking_mode=str(advanced.get("thinking_mode") or "off"),
            thinking_config=(
                advanced.get("thinking_config")
                if isinstance(advanced.get("thinking_config"), dict)
                else None
            ),
            thinking_format=(
                advanced.get("thinking_format")
                if isinstance(advanced.get("thinking_format"), str)
                else None
            ),
            request_format=(
                advanced.get("request_format")
                if isinstance(advanced.get("request_format"), str)
                else None
            ),
            provider_preference=None,
            tool_choice=None,
            retry_config=settings_service.get_retry_config(db, user_id),
            native_tool_call=False,
        )

        text_parts: list[str] = []
        for part in result.snapshot.content_parts:
            if isinstance(part, dict) and part.get("type") == "content":
                text = part.get("text")
                if isinstance(text, str):
                    text_parts.append(text)

        return "".join(text_parts).strip()


summary_service = SummaryService()
