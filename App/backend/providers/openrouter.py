import json
import httpx
from typing import AsyncGenerator, List, Dict, Optional
from .base import BaseProvider
from .registry import ProviderRegistry

@ProviderRegistry.register
class OpenRouterProvider(BaseProvider):
    """OpenRouter API provider"""

    def __init__(self, config: Dict):
        super().__init__(config)
        self.api_key = config.get("api_key")
        self.base_url = "https://openrouter.ai/api/v1"

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def display_name(self) -> str:
        return "OpenRouter"

    def validate_config(self) -> bool:
        """OpenRouter requires API key"""
        return bool(self.api_key)

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        functions: Optional[List[Dict]] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        reasoning_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None
    ) -> AsyncGenerator[bytes, None]:
        """Stream chat completions from OpenRouter API"""

        if not self.validate_config():
            yield f"event: error\ndata: {json.dumps({'message': 'API key required for OpenRouter'})}\n\n".encode()
            return

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://novelgenerator.local",
            "X-Title": "Novel Generator"
        }

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

        # Add provider preference (only/ignore)
        if provider_preference:
            provider_obj = {}
            if provider_preference.get("only"):
                provider_obj["only"] = provider_preference["only"]
            if provider_preference.get("ignore"):
                provider_obj["ignore"] = provider_preference["ignore"]

            if provider_obj:
                body["provider"] = provider_obj

        # Add reasoning configuration for model-native reasoning
        if reasoning_config:
            reasoning_obj = {}
            if reasoning_config.get("effort"):
                reasoning_obj["effort"] = reasoning_config["effort"]
            if reasoning_config.get("max_tokens"):
                reasoning_obj["max_tokens"] = reasoning_config["max_tokens"]

            if reasoning_obj:
                body["reasoning"] = reasoning_obj

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
                                # Extract reasoning_details.text for real-time streaming (model mode)
                                if thinking_mode == 'model':
                                    try:
                                        chunk_str = chunk.decode('utf-8')
                                        lines = chunk_str.strip().split('\n')

                                        for line in lines:
                                            if line.startswith('data: '):
                                                data_str = line[6:]
                                                if data_str and data_str != '[DONE]':
                                                    try:
                                                        data = json.loads(data_str)
                                                        delta = data.get('choices', [{}])[0].get('delta', {})

                                                        # Extract reasoning.text from reasoning_details
                                                        if 'reasoning_details' in delta:
                                                            for detail in delta['reasoning_details']:
                                                                if detail.get('type') == 'text' and detail.get('text'):
                                                                    # Emit as separate reasoning chunk
                                                                    reasoning_chunk = {
                                                                        "choices": [{
                                                                            "delta": {
                                                                                "reasoning": {"text": detail['text']}
                                                                            }
                                                                        }]
                                                                    }
                                                                    yield f"data: {json.dumps(reasoning_chunk)}\n\n".encode()
                                                    except json.JSONDecodeError:
                                                        pass  # Skip malformed JSON
                                    except:
                                        pass  # Ignore decode errors

                                # Always pass through original chunk
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
        """Get available models from OpenRouter API"""

        if not self.validate_config():
            raise ValueError("API key required for OpenRouter")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/models/user",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    }
                )

                if response.status_code != 200:
                    raise Exception(f"Failed to fetch models: {response.text}")

                return response.json()

        except httpx.RequestError as e:
            raise Exception(f"Network error: {str(e)}")
        except Exception as e:
            raise Exception(f"Error fetching models: {str(e)}")
