from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Literal

class ProviderConfig(BaseModel):
    """Provider-specific configuration sent from frontend"""
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    additional_headers: Optional[Dict[str, str]] = None

class ProviderPreference(BaseModel):
    """Provider preference for OpenRouter (only/ignore lists)"""
    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None

class ContentPart(BaseModel):
    """A part of message content (content or thinking)"""
    type: Literal["content", "thinking"]
    text: str

class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    contentParts: List[ContentPart]

    def get_content_text(self) -> str:
        """Extract text content from contentParts for LLM providers"""
        return "".join(part.text for part in self.contentParts if part.type == "content")

class ChatCompletionRequest(BaseModel):
    messages: List[Message]
    model: str = "gpt-4"
    temperature: float = Field(default=0.7, ge=0, le=2)
    functions: Optional[List[Dict]] = None
    max_tokens: Optional[int] = None
    config: ProviderConfig = Field(default_factory=ProviderConfig)
    provider_preference: Optional[ProviderPreference] = None
    reasoning_config: Optional[dict] = None  # preserved for provider compatibility if ever passed through
    thinking_mode: Optional[Literal["off", "custom", "model"]] = "off"
