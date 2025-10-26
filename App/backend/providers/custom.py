import json
import httpx
from typing import AsyncGenerator, List, Dict, Optional
from .base import BaseProvider
from .registry import ProviderRegistry
from .thinking_parser import ThinkingStreamParser

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
        provider_preference: Optional[Dict] = None,
        reasoning_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None
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
                        parser = ThinkingStreamParser() if thinking_mode == 'custom' else None

                        async for chunk in response.aiter_bytes():
                            if chunk:
                                if parser:
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
                                                        content = delta.get('content', '')

                                                        if content:
                                                            # Process through thinking parser
                                                            clean_content, thinking_block = parser.process_chunk(content)

                                                            # Emit cleaned content
                                                            if clean_content:
                                                                content_chunk = {
                                                                    "choices": [{
                                                                        "delta": {"content": clean_content}
                                                                    }]
                                                                }
                                                                yield f"data: {json.dumps(content_chunk)}\n\n".encode()

                                                            # Emit complete thinking block
                                                            if thinking_block:
                                                                thinking_chunk = {
                                                                    "choices": [{
                                                                        "delta": {
                                                                            "reasoning": {"text": thinking_block}
                                                                        }
                                                                    }]
                                                                }
                                                                yield f"data: {json.dumps(thinking_chunk)}\n\n".encode()
                                                        else:
                                                            # Pass through non-content chunks (tool_calls, etc.)
                                                            yield chunk.encode() if isinstance(chunk, str) else chunk
                                                            break
                                                    except json.JSONDecodeError:
                                                        # Pass through non-JSON lines
                                                        yield chunk
                                                        break
                                            else:
                                                # Pass through non-data lines
                                                yield chunk
                                                break
                                    except:
                                        # Parse error - pass through
                                        yield chunk
                                else:
                                    # No thinking mode - pass through
                                    yield chunk

                        # Finalize parser on stream end
                        if parser:
                            final_content, final_thinking = parser.finalize()
                            if final_content:
                                final_content_chunk = {
                                    "choices": [{"delta": {"content": final_content}}]
                                }
                                yield f"data: {json.dumps(final_content_chunk)}\n\n".encode()
                            if final_thinking:
                                final_thinking_chunk = {
                                    "choices": [{
                                        "delta": {"reasoning": {"text": final_thinking}}
                                    }]
                                }
                                yield f"data: {json.dumps(final_thinking_chunk)}\n\n".encode()

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
