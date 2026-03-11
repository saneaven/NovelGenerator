from __future__ import annotations

from functools import lru_cache
from typing import Any


@lru_cache(maxsize=1)
def _build_tool_engine():
    from .module_loader import build_registry
    from .service import ToolEngineService

    return ToolEngineService(build_registry())


class _ToolEngineProxy:
    def __getattr__(self, name: str) -> Any:
        return getattr(_build_tool_engine(), name)


tool_engine = _ToolEngineProxy()

__all__ = ["tool_engine"]
