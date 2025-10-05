import os
import json
import httpx
from typing import AsyncGenerator, List, Dict, Optional
from .base import BaseProvider
from .registry import ProviderRegistry

@ProviderRegistry.register
class CopilotProvider(BaseProvider):
    """GitHub Copilot API provider"""

    def __init__(self, config: Dict):
        super().__init__(config)
        self.api_key = os.getenv("COPILOT_TOKEN")
        self.base_url = "https://api.githubcopilot.com"

    @property
    def name(self) -> str:
        return "copilot"

    @property
    def display_name(self) -> str:
        return "GitHub Copilot"

    def validate_config(self) -> bool:
        """Copilot uses server-side token, no client config needed"""
        return bool(self.api_key)

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        functions: Optional[List[Dict]] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None
    ) -> AsyncGenerator[bytes, None]:
        """Stream chat completions from GitHub Copilot API"""

        if not self.validate_config():
            raise ValueError("COPILOT_TOKEN not configured in environment")

        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }

        body = {
            "messages": messages,
            "stream": True,
            "model": model
        }

        # Add optional parameters
        if max_tokens:
            body["max_tokens"] = max_tokens

        # Convert functions to tools format (OpenAI tools spec)
        if functions:
            tools = [{"type": "function", "function": func} for func in functions]
            body["tools"] = tools
            body["tool_choice"] = "auto"

        MAX_RETRIES = 10
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

                            # Retry on server errors or certain client errors
                            if (response.status_code >= 500 or
                                response.status_code in [403, 400]) and retry_count < MAX_RETRIES - 1:
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
        """Get available models from GitHub Copilot API"""

        if not self.validate_config():
            raise ValueError("COPILOT_TOKEN not configured in environment")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={
                        "authorization": f"Bearer {self.api_key}",
                        "content-type": "application/json"
                    }
                )

                if response.status_code != 200:
                    raise Exception(f"Failed to fetch models: {response.text}")

                return response.json()

        except httpx.RequestError as e:
            raise Exception(f"Network error: {str(e)}")
        except Exception as e:
            raise Exception(f"Error fetching models: {str(e)}")
