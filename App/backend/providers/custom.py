import json
import httpx
from typing import AsyncGenerator, List, Dict, Optional
from .base import BaseProvider
from .registry import ProviderRegistry

@ProviderRegistry.register
class CustomOpenAIProvider(BaseProvider):
    """Custom OpenAI-compatible API provider"""

    def __init__(self, config: Dict):
        super().__init__(config)
        self.api_key = config.get("api_key")
        self.base_url = config.get("base_url", "").rstrip("/")
        self.additional_headers = config.get("additional_headers", {})

    @property
    def name(self) -> str:
        return "custom"

    @property
    def display_name(self) -> str:
        return "Custom OpenAI-Compatible"

    def validate_config(self) -> bool:
        """Custom provider requires base URL"""
        return bool(self.base_url)

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        functions: Optional[List[Dict]] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None
    ) -> AsyncGenerator[bytes, None]:
        """Stream chat completions from custom OpenAI-compatible API"""

        if not self.validate_config():
            yield f"event: error\ndata: {json.dumps({'message': 'Base URL required for custom provider'})}\n\n".encode()
            return

        headers = {
            "Content-Type": "application/json",
            **self.additional_headers
        }

        # Add API key if provided
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        body = {
            "messages": messages,
            "stream": True,
            "model": model,
            "temperature": temperature
        }

        # Add optional parameters
        if max_tokens:
            body["max_tokens"] = max_tokens

        # Convert functions to tools format
        if functions:
            tools = [{"type": "function", "function": func} for func in functions]
            body["tools"] = tools
            body["tool_choice"] = "auto"

        MAX_RETRIES = 3
        retry_count = 0

        while retry_count < MAX_RETRIES:
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=body,
                    ) as response:
                        # Handle errors
                        if response.status_code >= 400:
                            error_text = await response.aread()
                            error_msg = error_text.decode("utf-8", errors="ignore") or response.reason_phrase

                            # Retry on server errors
                            if response.status_code >= 500 and retry_count < MAX_RETRIES - 1:
                                retry_count += 1
                                continue
                            else:
                                yield f"event: error\ndata: {json.dumps({'status': response.status_code, 'message': error_msg})}\n\n".encode()
                                return

                        # Stream successful response
                        async for chunk in response.aiter_bytes():
                            if chunk:
                                yield chunk
                        return

            except httpx.RequestError as e:
                retry_count += 1
                if retry_count >= MAX_RETRIES:
                    yield f"event: error\ndata: {json.dumps({'message': f'Network error after {MAX_RETRIES} retries: {str(e)}'})}\n\n".encode()
                    return
            except Exception as e:
                yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n".encode()
                return

    async def get_models(self) -> Dict:
        """Get available models from custom OpenAI-compatible API"""

        if not self.validate_config():
            raise ValueError("Base URL required for custom provider")

        headers = {
            "Content-Type": "application/json",
            **self.additional_headers
        }

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers=headers
                )

                if response.status_code != 200:
                    raise Exception(f"Failed to fetch models: {response.text}")

                return response.json()

        except httpx.RequestError as e:
            raise Exception(f"Network error: {str(e)}")
        except Exception as e:
            raise Exception(f"Error fetching models: {str(e)}")
