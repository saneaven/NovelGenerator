from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from ....providers.shared.contracts import MetaPayload
from ....providers.shared.transport.request_logging import build_logged_request_body
from ...llm_request_service import llm_request_service

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LLMRequestContext:
    request_id: str
    user_id: Any
    project_id: Any
    thread_id: Any
    run_id: Any
    assistant_message_id: Any
    provider: str
    model: str


class LLMRequestSession:
    def __init__(
        self,
        *,
        request_id: str,
        user_id: Any,
        project_id: Any,
        thread_id: Any,
        run_id: Any,
        assistant_message_id: Any,
        provider: str,
        model: str,
        logging_enabled: bool,
    ) -> None:
        self._ctx = LLMRequestContext(
            request_id=request_id,
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            run_id=run_id,
            assistant_message_id=assistant_message_id,
            provider=provider,
            model=model,
        )
        self._logging_enabled = logging_enabled
        self._started_at = time.monotonic()
        self._retry_count = 0
        self._closed = False

    @property
    def retry_count(self) -> int:
        return self._retry_count

    def on_request(self, raw_request: dict[str, Any]) -> None:
        try:
            llm_request_service.update_request(
                self._ctx.request_id,
                raw_input=build_logged_request_body(raw_request) if self._logging_enabled else None,
            )
        except Exception:
            logger.warning("LLM request update failed", exc_info=True)

    def on_retry(self, error_msg: str, error_status: int | None) -> None:
        if self._closed:
            return
        try:
            llm_request_service.on_retry(
                self._ctx.request_id,
                error_msg=error_msg,
                error_status=error_status,
            )
            self._retry_count += 1
        except Exception:
            logger.warning("LLM request retry update failed", exc_info=True)

    def fail(
        self,
        error: str,
        *,
        content_parts: list[dict[str, Any]] | None,
        merged_meta: MetaPayload | None,
    ) -> None:
        if self._closed:
            return
        try:
            llm_request_service.fail(
                self._ctx.request_id,
                raw_output=self._build_partial_output(content_parts, merged_meta) if self._logging_enabled else None,
                error=error,
                meta=self._build_meta(merged_meta),
            )
            self._closed = True
        except Exception:
            logger.warning("LLM request fail update failed", exc_info=True)

    def complete(
        self,
        raw_output: dict[str, Any] | None,
        merged_meta: MetaPayload | None,
    ) -> None:
        if self._closed:
            return
        try:
            llm_request_service.complete(
                self._ctx.request_id,
                raw_output=raw_output if self._logging_enabled else None,
                meta=self._build_meta(merged_meta),
            )
            self._closed = True
        except Exception:
            logger.warning("LLM request complete update failed", exc_info=True)

    def _build_partial_output(
        self,
        content_parts: list[dict[str, Any]] | None,
        merged_meta: MetaPayload | None,
    ) -> dict[str, Any] | None:
        partial: dict[str, Any] = {}
        if content_parts:
            partial["content_parts"] = content_parts
        if merged_meta and merged_meta.usage:
            partial["usage"] = merged_meta.usage
        return partial or None

    def _build_meta(self, merged_meta: MetaPayload | None) -> dict[str, Any]:
        meta: dict[str, Any] = {"response_time_ms": self._elapsed_ms()}
        if merged_meta is not None:
            if merged_meta.usage:
                meta["usage"] = merged_meta.usage
            if merged_meta.finish_reason:
                meta["finish_reason"] = merged_meta.finish_reason
            if merged_meta.reasoning_tokens is not None:
                meta["reasoning_tokens"] = merged_meta.reasoning_tokens
        return meta

    def _elapsed_ms(self) -> int:
        return int((time.monotonic() - self._started_at) * 1000)
