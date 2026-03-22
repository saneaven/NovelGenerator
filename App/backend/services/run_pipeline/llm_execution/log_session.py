from __future__ import annotations

import logging
import time
from typing import Any

from ....providers.contracts import MetaPayload
from ...llm_log_service import llm_log_service

logger = logging.getLogger(__name__)


class LLMLogSession:
    def __init__(
        self,
        *,
        enabled: bool,
        user_id: Any,
        project_id: Any,
        provider: str,
        model: str,
    ) -> None:
        self._enabled = enabled
        self._user_id = user_id
        self._project_id = project_id
        self._provider = provider
        self._model = model
        self._log_id: Any = None
        self._started_at: float | None = None

    def on_request(self, raw_request: dict[str, Any]) -> None:
        if not self._enabled:
            return
        try:
            if self._log_id is None:
                self._started_at = time.monotonic()
                self._log_id = llm_log_service.create_log(
                    user_id=self._user_id,
                    project_id=self._project_id,
                    provider=self._provider,
                    model=self._model,
                    raw_input=raw_request,
                )
                return

            llm_log_service.reset_log(self._log_id, raw_input=raw_request)
            self._started_at = time.monotonic()
        except Exception:
            logger.warning("LLM log create/reset failed", exc_info=True)

    def fail(
        self,
        error_msg: str,
        *,
        content_parts: list[dict[str, Any]] | None,
        merged_meta: MetaPayload | None,
    ) -> None:
        if not self._enabled or self._log_id is None:
            return
        try:
            partial: dict[str, Any] | None = None
            if content_parts:
                partial = {"content_parts": content_parts}
                if merged_meta and merged_meta.usage:
                    partial["usage"] = merged_meta.usage
            llm_log_service.fail_log(
                self._log_id,
                raw_output=partial,
                error=error_msg,
                meta={"response_time_ms": self._elapsed_ms()},
            )
            self._log_id = None
        except Exception:
            logger.warning("LLM log fail_log failed", exc_info=True)

    def complete(self, raw_output: dict[str, Any] | None) -> None:
        if not self._enabled or self._log_id is None:
            return
        try:
            llm_log_service.complete_log(
                self._log_id,
                raw_output=raw_output,
                meta={"response_time_ms": self._elapsed_ms()},
            )
            self._log_id = None
        except Exception:
            logger.warning("LLM log complete failed", exc_info=True)

    def _elapsed_ms(self) -> int:
        return int((time.monotonic() - (self._started_at or 0)) * 1000)
