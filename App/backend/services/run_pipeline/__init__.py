from __future__ import annotations

from ...database import SessionLocal
from ..runtime_event_dispatcher import runtime_event_dispatcher
from .service import RunPipeline

# Ensure providers are registered.
from ...providers.llm import async_openai_provider as _register_openai  # noqa: F401
from ...providers.llm import claude_provider as _register_claude  # noqa: F401
from ...providers.llm import gemini_provider as _register_gemini  # noqa: F401
from ...providers.llm import openai_responses_provider as _register_openai_responses  # noqa: F401
from ...providers.llm import openrouter as _register_openrouter  # noqa: F401
from ...providers.llm import xai_provider as _register_xai  # noqa: F401
from ...providers.llm import custom as _register_custom  # noqa: F401

run_pipeline = RunPipeline(db_factory=SessionLocal, event_dispatcher=runtime_event_dispatcher)

__all__ = ["run_pipeline", "RunPipeline"]
