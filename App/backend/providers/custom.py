from typing import Dict, List, Optional, Tuple

from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry


@ProviderRegistry.register
class CustomOpenAIProvider(AsyncOpenAIProvider):
    """Generic OpenAI-compatible endpoint provider with configurable thinking formats."""

    def __init__(self, config: Dict):
        self._base_url = (config.get("base_url") or "").strip()
        self._additional_headers = config.get("additional_headers") or {}
        super().__init__(config)

    @property
    def name(self) -> str:
        return "custom"

    @property
    def display_name(self) -> str:
        return "Custom OpenAI-Compatible"

    def validate_config(self) -> bool:
        return bool(self._base_url)

    @property
    def base_url(self) -> str:
        return self._base_url.rstrip("/")

    @property
    def default_headers(self) -> Dict[str, str]:
        return self._additional_headers

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        model: str = "",
    ) -> Optional[Dict]:
        """Build extra_body based on selected thinking format."""
        if not thinking_config:
            return None

        fmt = thinking_config.get("custom_thinking_format")
        if not fmt:
            return None

        extra: Dict = {}

        if fmt == "openai":
            # OpenAI format: reasoning object + verbosity as separate top-level param
            reasoning: Dict = {"summary": "auto"}  # Always request summaries
            effort = thinking_config.get("effort")
            if effort:
                reasoning["effort"] = effort
            extra["reasoning"] = reasoning
            # verbosity is a separate top-level parameter, not inside reasoning
            verbosity = thinking_config.get("verbosity")
            if verbosity:
                extra["verbosity"] = verbosity

        elif fmt == "claude":
            # Claude format: thinking with type and budget_tokens
            budget = thinking_config.get("claude_budget_tokens")
            if budget and budget >= 1024:
                extra["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": budget
                }

        elif fmt == "gemini":
            # Gemini format: google.thinking_config with thinking_level
            level = thinking_config.get("gemini_thinking_level")
            if level:
                extra["google"] = {"thinking_config": {"thinking_level": level}}

        elif fmt == "openrouter":
            # OpenRouter format: reasoning with effort and optional max_tokens
            reasoning = {}
            effort = thinking_config.get("effort")
            if effort:
                reasoning["effort"] = effort
            max_tokens = thinking_config.get("max_tokens")
            if max_tokens:
                reasoning["max_tokens"] = max_tokens
            if reasoning:
                extra["reasoning"] = reasoning

        return extra or None

    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        """Extract thinking from response based on various provider formats."""
        if thinking_mode != "model":
            return chunk, []

        choices = chunk.get("choices") or []
        if not choices:
            return chunk, []

        delta = choices[0].get("delta") or {}
        thinking_result = None

        # 1. OpenRouter/OpenAI style - reasoning_details or thinking_details
        for field in ["thinking_details", "reasoning_details"]:
            details = delta.get(field)
            if details and isinstance(details, list):
                for d in details:
                    if isinstance(d, dict):
                        detail_type = d.get("type", "")

                        # Summary type (e.g., "reasoning.summary")
                        if "summary" in detail_type or d.get("summary"):
                            thinking_result = {
                                "type": "summary",
                                "text": d.get("summary") or d.get("text", ""),
                            }
                        # Full text type (e.g., "reasoning.text")
                        elif d.get("text"):
                            thinking_result = {
                                "type": "text",
                                "text": d["text"],
                            }
                        # Encrypted type
                        elif d.get("encrypted") or "encrypted" in detail_type:
                            thinking_result = {
                                "type": "encrypted",
                                "signature": d.get("signature") or d.get("data", ""),
                            }

                        # Preserve signature if present
                        if d.get("signature") and thinking_result:
                            thinking_result["signature"] = d["signature"]

                        if thinking_result:
                            break
                if thinking_result:
                    break

        # 2. Claude style - thinking_delta event type
        if not thinking_result and delta.get("type") == "thinking_delta":
            thinking_result = {
                "type": "text",  # Claude returns full thinking
                "text": delta.get("thinking", ""),
            }

        # 3. Gemini style - thought field (usually summaries)
        if not thinking_result and delta.get("thought"):
            thinking_result = {
                "type": "summary",  # Gemini returns thought summaries
                "text": delta["thought"],
            }
            if delta.get("thought_signature"):
                thinking_result["signature"] = delta["thought_signature"]

        # 4. OpenAI Responses API style - reasoning with content/summary arrays
        if not thinking_result:
            reasoning = delta.get("reasoning")
            if isinstance(reasoning, dict):
                # Check for summary array first (summarized reasoning)
                summary_arr = reasoning.get("summary")
                if summary_arr and isinstance(summary_arr, list) and len(summary_arr) > 0:
                    first_item = summary_arr[0]
                    thinking_result = {
                        "type": "summary",
                        "text": first_item.get("text", "") if isinstance(first_item, dict) else str(first_item),
                    }
                # Then check for content array (full reasoning - usually hidden)
                elif reasoning.get("content"):
                    content = reasoning["content"]
                    if isinstance(content, list) and len(content) > 0:
                        first_item = content[0]
                        thinking_result = {
                            "type": "text",
                            "text": first_item.get("text", "") if isinstance(first_item, dict) else str(first_item),
                        }
                    elif isinstance(content, str):
                        thinking_result = {
                            "type": "text",
                            "text": content,
                        }

        # Set the thinking field if we found any thinking content
        if thinking_result:
            delta["thinking"] = thinking_result

        return chunk, []
