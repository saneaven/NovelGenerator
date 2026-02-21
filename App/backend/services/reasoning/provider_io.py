from __future__ import annotations

from typing import Any, Protocol


class ProviderIO(Protocol):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        ...

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        ...

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        ...
