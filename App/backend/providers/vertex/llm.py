from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from google import genai
from google.genai import types
from google.oauth2 import service_account

from ..gemini.llm import GeminiProvider
from ..shared.transport.client_timeouts import get_llm_stream_timeout


_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
_TOKEN_URIS = {
    "https://oauth2.googleapis.com/token",
    "https://accounts.google.com/o/oauth2/token",
}


def prepare_config(
    *,
    provider_config: dict[str, Any],
    runtime_spec: Any = None,
    purpose: str = "llm",
    variant_hint: str | None = None,
) -> dict[str, Any]:
    del runtime_spec, purpose, variant_hint
    if not isinstance(provider_config, dict):
        raise ValueError("Vertex requires valid Google Cloud service account credentials.")
    project_id = provider_config.get("project_id")
    if not isinstance(project_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", project_id.strip()):
        raise ValueError("Vertex project_id must be a Google Cloud project ID or number.")
    location = provider_config.get("location", "global")
    if not isinstance(location, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", location.strip()):
        raise ValueError("Vertex location must be a Google Cloud location.")
    info = provider_config.get("service_account_json")
    if (
        not isinstance(info, dict)
        or info.get("type") != "service_account"
        or not isinstance(info.get("client_email"), str)
        or not info.get("client_email", "").strip()
        or not isinstance(info.get("private_key"), str)
        or not info.get("private_key", "").strip()
        or not isinstance(info.get("token_uri"), str)
        or info.get("token_uri") not in _TOKEN_URIS
        or info.get("universe_domain", "googleapis.com") != "googleapis.com"
    ):
        raise ValueError("Vertex requires a valid Google service account JSON object.")
    try:
        service_account.Credentials.from_service_account_info(info, scopes=[_CLOUD_PLATFORM_SCOPE])
    except Exception:
        raise ValueError("Vertex requires a valid Google service account JSON object.") from None
    return {
        "project_id": project_id.strip(),
        "location": location.strip(),
        "service_account_json": deepcopy(info),
    }


class VertexProvider(GeminiProvider):
    """Gemini model invocation with user-owned Google Cloud credentials."""

    @property
    def name(self) -> str:
        return "vertex"

    @property
    def display_name(self) -> str:
        return "Gemini Enterprise Agent Platform"

    def validate_config(self) -> bool:
        try:
            prepare_config(provider_config=self.config)
        except ValueError:
            return False
        return True

    def _build_client(self) -> genai.Client:
        config = prepare_config(provider_config=self.config)
        credentials = service_account.Credentials.from_service_account_info(
            config["service_account_json"],
            scopes=[_CLOUD_PLATFORM_SCOPE],
        )
        return genai.Client(
            enterprise=True,
            project=config["project_id"],
            location=config["location"],
            credentials=credentials,
            http_options=types.HttpOptions(timeout=int(get_llm_stream_timeout().read * 1000)),
        )

    @staticmethod
    def _text_model_id(name: Any) -> str | None:
        if not isinstance(name, str):
            return None
        name = name.strip()
        if name.startswith("publishers/google/models/"):
            model_id = name.removeprefix("publishers/google/models/")
        elif re.fullmatch(r"projects/[^/]+/locations/[^/]+/publishers/google/models/[^/]+", name):
            model_id = name.rsplit("/", 1)[-1]
        elif name.startswith("models/"):
            model_id = name.removeprefix("models/")
        else:
            model_id = name
        if not re.fullmatch(r"gemini-[a-z0-9][a-z0-9.-]*", model_id):
            return None
        if any(kind in model_id for kind in ("embedding", "image", "audio", "tts", "live", "robotics")):
            return None
        return model_id

    async def get_models(self) -> dict[str, Any]:
        if not self.validate_config():
            raise ValueError("Vertex requires valid Google Cloud service account credentials.")
        client = self._ensure_client()
        pager = await client.aio.models.list(config={"query_base": True})
        models: list[dict[str, Any]] = []
        seen: set[str] = set()
        async for model in pager:
            model_id = self._text_model_id(getattr(model, "name", None))
            if model_id is None or model_id in seen:
                continue
            seen.add(model_id)
            models.append({
                "id": model_id,
                "display_name": getattr(model, "display_name", None) or model_id,
                "description": getattr(model, "description", None),
                "input_token_limit": getattr(model, "input_token_limit", None),
                "output_token_limit": getattr(model, "output_token_limit", None),
            })
        return {"data": models}


def create_provider(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return VertexProvider(provider_config)
