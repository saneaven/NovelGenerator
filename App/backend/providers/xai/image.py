from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI, OpenAIError

from ..shared.image.contracts import ImageGenerationOutput, PreparedImageRequest


class XAIImageAdapter:
    XAI_BASE_URL = "https://api.x.ai/v1"

    def __init__(self, provider_config: dict[str, Any]):
        self._api_key = str(provider_config.get("api_key") or "").strip()
        self._client = (
            AsyncOpenAI(api_key=self._api_key, base_url=self.XAI_BASE_URL)
            if self._api_key
            else None
        )

    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        if self._client is None:
            return ImageGenerationOutput(
                success=False,
                error="xAI client not initialized. Check API key.",
            )

        prompt = request.prompt_payload.prompt
        if prompt is None:
            return ImageGenerationOutput(
                success=False,
                error="Prompt is required for xAI image generation.",
            )

        try:
            response = await self._client.images.generate(
                model=request.model_descriptor.id,
                prompt=f"{prompt.prefix}{prompt.content}{prompt.postfix}",
                n=1,
                response_format="b64_json",
            )
        except OpenAIError as exc:
            return ImageGenerationOutput(success=False, error=f"xAI API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationOutput(success=False, error=f"Unexpected error: {exc}")

        if not response.data:
            return ImageGenerationOutput(success=False, error="No image data in response")

        image_data = response.data[0]
        return ImageGenerationOutput(
            success=True,
            image_b64=image_data.b64_json,
            revised_prompt=getattr(image_data, "revised_prompt", None),
            width=1024,
            height=1024,
            format="png",
        )


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return XAIImageAdapter(provider_config)
