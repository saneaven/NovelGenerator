from __future__ import annotations

from .module_loader import build_registry
from .service import ToolEngineService


tool_engine = ToolEngineService(build_registry())

__all__ = ["tool_engine", "ToolEngineService"]
