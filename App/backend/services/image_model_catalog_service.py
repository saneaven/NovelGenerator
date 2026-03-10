from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - optional in lightweight test envs
    httpx = None  # type: ignore[assignment]


OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
OPENROUTER_DEFAULT_RATIOS = [
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
]
OPENROUTER_DEFAULT_IMAGE_SIZES = ["1K", "2K", "4K"]
OPENROUTER_IMAGE_MODEL_OVERRIDES: dict[str, dict[str, list[str]]] = {
    "google/gemini-3.1-flash-image-preview": {
        "supported_aspect_ratios": [
            "1:1",
            "2:3",
            "3:2",
            "3:4",
            "4:3",
            "4:5",
            "5:4",
            "9:16",
            "16:9",
            "21:9",
            "1:4",
            "4:1",
            "1:8",
            "8:1",
        ],
        "supported_image_sizes": ["512px", "1K", "2K", "4K"],
    },
    "google/gemini-3-pro-image-preview": {
        "supported_aspect_ratios": [
            "1:1",
            "2:3",
            "3:2",
            "3:4",
            "4:3",
            "4:5",
            "5:4",
            "9:16",
            "16:9",
            "21:9",
        ],
        "supported_image_sizes": ["1K", "2K", "4K"],
    },
}
OPENAI_PROVIDER_SETTINGS_KEYS = {
    "quality",
    "background",
    "output_format",
    "output_compression",
    "input_fidelity",
}
NOVELAI_PROVIDER_SETTINGS_KEYS = {
    "sampler",
    "steps",
    "scale",
    "noise_schedule",
    "referenceMode",
    "strength",
    "i2iNoise",
    "vibeStrength",
    "vibeInfoExtracted",
}


@dataclass(frozen=True)
class ImageModelRecord:
    id: str
    name: str
    prompt_type: str
    supports_image_input: bool
    supported_aspect_ratios: tuple[str, ...]
    supported_image_sizes: tuple[str, ...]
    default_aspect_ratio: str
    default_image_size: str
    ui_resolution_mode: str
    native_size_by_aspect_ratio: dict[str, str] | None = None
    description: str | None = None
    canonical_slug: str | None = None
    architecture: dict[str, Any] | None = None
    pricing: dict[str, Any] | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "canonical_slug": self.canonical_slug,
            "prompt_type": self.prompt_type,
            "supports_image_input": self.supports_image_input,
            "supported_aspect_ratios": list(self.supported_aspect_ratios),
            "supported_image_sizes": list(self.supported_image_sizes),
            "default_aspect_ratio": self.default_aspect_ratio,
            "default_image_size": self.default_image_size,
            "ui_resolution_mode": self.ui_resolution_mode,
            "architecture": self.architecture,
            "pricing": self.pricing,
        }


@dataclass(frozen=True)
class ResolvedImageGeometry:
    model: str
    prompt_type: str
    supports_image_input: bool
    requested_aspect_ratio: str
    requested_image_size: str
    resolved_aspect_ratio: str
    resolved_image_size: str
    resolved_native_size: str


STATIC_MODEL_RECORDS: dict[str, tuple[ImageModelRecord, ...]] = {
    "openai": (
        ImageModelRecord(
            id="gpt-image-1.5",
            name="GPT Image 1.5",
            prompt_type="natural",
            supports_image_input=True,
            supported_aspect_ratios=("1:1", "3:2", "2:3"),
            supported_image_sizes=("1K",),
            default_aspect_ratio="1:1",
            default_image_size="1K",
            ui_resolution_mode="translated_fixed",
            native_size_by_aspect_ratio={"1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536"},
        ),
        ImageModelRecord(
            id="gpt-image-1",
            name="GPT Image 1",
            prompt_type="natural",
            supports_image_input=True,
            supported_aspect_ratios=("1:1", "3:2", "2:3"),
            supported_image_sizes=("1K",),
            default_aspect_ratio="1:1",
            default_image_size="1K",
            ui_resolution_mode="translated_fixed",
            native_size_by_aspect_ratio={"1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536"},
        ),
    ),
    "gemini": (
        ImageModelRecord(
            id="gemini-3.1-flash-image-preview",
            name="Gemini 3.1 Flash Image Preview",
            prompt_type="natural",
            supports_image_input=True,
            supported_aspect_ratios=tuple(OPENROUTER_IMAGE_MODEL_OVERRIDES["google/gemini-3.1-flash-image-preview"]["supported_aspect_ratios"]),
            supported_image_sizes=tuple(OPENROUTER_IMAGE_MODEL_OVERRIDES["google/gemini-3.1-flash-image-preview"]["supported_image_sizes"]),
            default_aspect_ratio="1:1",
            default_image_size="1K",
            ui_resolution_mode="native_tier",
        ),
        ImageModelRecord(
            id="gemini-3-pro-image-preview",
            name="Gemini 3 Pro Image Preview",
            prompt_type="natural",
            supports_image_input=True,
            supported_aspect_ratios=tuple(OPENROUTER_IMAGE_MODEL_OVERRIDES["google/gemini-3-pro-image-preview"]["supported_aspect_ratios"]),
            supported_image_sizes=tuple(OPENROUTER_IMAGE_MODEL_OVERRIDES["google/gemini-3-pro-image-preview"]["supported_image_sizes"]),
            default_aspect_ratio="1:1",
            default_image_size="1K",
            ui_resolution_mode="native_tier",
        ),
    ),
    "xai": (
        ImageModelRecord(
            id="grok-2-image",
            name="Grok 2 Image",
            prompt_type="natural",
            supports_image_input=False,
            supported_aspect_ratios=("1:1", "4:7", "7:4"),
            supported_image_sizes=("1K",),
            default_aspect_ratio="1:1",
            default_image_size="1K",
            ui_resolution_mode="translated_fixed",
            native_size_by_aspect_ratio={"1:1": "1024x1024", "4:7": "1024x1792", "7:4": "1792x1024"},
        ),
        ImageModelRecord(
            id="grok-2-image-1212",
            name="Grok 2 Image 1212",
            prompt_type="natural",
            supports_image_input=False,
            supported_aspect_ratios=("1:1", "4:7", "7:4"),
            supported_image_sizes=("1K",),
            default_aspect_ratio="1:1",
            default_image_size="1K",
            ui_resolution_mode="translated_fixed",
            native_size_by_aspect_ratio={"1:1": "1024x1024", "4:7": "1024x1792", "7:4": "1792x1024"},
        ),
    ),
    "novelai": (
        ImageModelRecord(
            id="nai-diffusion-4-5-full",
            name="NAI Diffusion V4.5 Full",
            prompt_type="tag_based",
            supports_image_input=True,
            supported_aspect_ratios=("1:1", "13:19", "19:13", "2:3", "3:2", "5:12", "12:5"),
            supported_image_sizes=("1K",),
            default_aspect_ratio="13:19",
            default_image_size="1K",
            ui_resolution_mode="translated_fixed",
            native_size_by_aspect_ratio={
                "1:1": "1024x1024",
                "13:19": "832x1216",
                "19:13": "1216x832",
                "2:3": "1024x1536",
                "3:2": "1536x1024",
                "5:12": "640x1536",
                "12:5": "1536x640",
            },
        ),
        ImageModelRecord(
            id="nai-diffusion-4-5-curated",
            name="NAI Diffusion V4.5 Curated",
            prompt_type="tag_based",
            supports_image_input=True,
            supported_aspect_ratios=("1:1", "13:19", "19:13", "2:3", "3:2", "5:12", "12:5"),
            supported_image_sizes=("1K",),
            default_aspect_ratio="13:19",
            default_image_size="1K",
            ui_resolution_mode="translated_fixed",
            native_size_by_aspect_ratio={
                "1:1": "1024x1024",
                "13:19": "832x1216",
                "19:13": "1216x832",
                "2:3": "1024x1536",
                "3:2": "1536x1024",
                "5:12": "640x1536",
                "12:5": "1536x640",
            },
        ),
    ),
}


def _normalize_ratio_text(raw: Any, *, fallback: str = "1:1") -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback
    for sep in (":", "/", "x"):
        if sep not in text:
            continue
        left, right = text.split(sep, 1)
        try:
            width = int(float(left.strip()))
            height = int(float(right.strip()))
        except ValueError:
            return fallback
        if width <= 0 or height <= 0:
            return fallback
        divisor = _gcd(width, height)
        return f"{width // divisor}:{height // divisor}"
    return fallback


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a or 1


def _ratio_score(candidate: str, requested: str) -> float:
    c_value = _ratio_value(candidate)
    r_value = _ratio_value(requested)
    return abs(c_value - r_value)


def _ratio_value(raw: str) -> float:
    normalized = _normalize_ratio_text(raw)
    left, right = normalized.split(":")
    return int(left) / int(right)


def _pick_ratio(candidates: list[str], requested: str, *, fallback: str) -> str:
    if not candidates:
        return fallback
    normalized_requested = _normalize_ratio_text(requested, fallback=fallback)
    if normalized_requested in candidates:
        return normalized_requested
    return min(candidates, key=lambda candidate: _ratio_score(candidate, normalized_requested))


def sanitize_generation_settings(provider: str, settings: Any) -> dict[str, Any] | None:
    if not isinstance(settings, dict):
        return None

    allowlist: set[str]
    if provider == "openai":
        allowlist = OPENAI_PROVIDER_SETTINGS_KEYS
    elif provider == "novelai":
        allowlist = NOVELAI_PROVIDER_SETTINGS_KEYS
    else:
        allowlist = set()

    cleaned: dict[str, Any] = {}
    for key, value in settings.items():
        if key in {"size", "aspect_ratio", "image_resolution", "image_size"}:
            continue
        if key not in allowlist:
            continue
        cleaned[key] = value
    return cleaned or None


def default_image_gen_config() -> dict[str, Any]:
    return {
        "provider": "openai",
        "model": "gpt-image-1.5",
        "aspect_ratio": "1:1",
        "image_size": "1K",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {
            "quality": "auto",
            "background": "auto",
            "output_format": "png",
            "output_compression": 90,
            "input_fidelity": "high",
        },
        "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"},
    }


def migrate_image_gen_config(raw: Any) -> dict[str, Any]:
    defaults = default_image_gen_config()
    if not isinstance(raw, dict):
        return defaults

    provider = str(raw.get("provider") or defaults["provider"]).strip() or defaults["provider"]
    model = str(raw.get("model") or defaults["model"]).strip() or defaults["model"]

    if isinstance(raw.get("aspect_ratio"), str) and raw.get("aspect_ratio"):
        aspect_ratio = _normalize_ratio_text(raw.get("aspect_ratio"), fallback=defaults["aspect_ratio"])
    elif isinstance(raw.get("size"), str) and raw.get("size"):
        aspect_ratio = _normalize_ratio_text(raw.get("size"), fallback=defaults["aspect_ratio"])
    elif isinstance(raw.get("geminiSettings"), dict):
        aspect_ratio = _normalize_ratio_text(raw["geminiSettings"].get("aspect_ratio"), fallback=defaults["aspect_ratio"])
    else:
        aspect_ratio = defaults["aspect_ratio"]

    if isinstance(raw.get("image_size"), str) and raw.get("image_size"):
        image_size = str(raw.get("image_size")).strip()
    elif isinstance(raw.get("geminiSettings"), dict) and raw["geminiSettings"].get("image_resolution"):
        image_size = str(raw["geminiSettings"]["image_resolution"]).strip()
    else:
        image_size = "1K"

    migrated = {
        "provider": provider,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "image_size": image_size,
        "naturalStyles": raw.get("naturalStyles") if isinstance(raw.get("naturalStyles"), list) else [],
        "tagBasedStyles": raw.get("tagBasedStyles") if isinstance(raw.get("tagBasedStyles"), list) else [],
        "selectedNaturalStyleId": raw.get("selectedNaturalStyleId"),
        "selectedTagBasedStyleId": raw.get("selectedTagBasedStyleId"),
        "openaiSettings": defaults["openaiSettings"] | (
            raw.get("openaiSettings") if isinstance(raw.get("openaiSettings"), dict) else {}
        ),
        "novelaiSettings": defaults["novelaiSettings"] | (
            raw.get("novelaiSettings") if isinstance(raw.get("novelaiSettings"), dict) else {}
        ),
    }

    if provider in {"openai", "xai", "novelai"}:
        migrated["image_size"] = "1K"

    return migrated


def rewrite_image_run_recipe(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}

    provider = str(raw.get("provider") or "").strip()
    requested_aspect_ratio = ""
    if isinstance(raw.get("requested_aspect_ratio"), str) and raw.get("requested_aspect_ratio"):
        requested_aspect_ratio = _normalize_ratio_text(raw.get("requested_aspect_ratio"))
    elif isinstance(raw.get("requested_ratio"), str) and raw.get("requested_ratio"):
        requested_aspect_ratio = _normalize_ratio_text(raw.get("requested_ratio"))
    elif isinstance(raw.get("aspect_ratio"), str) and raw.get("aspect_ratio"):
        requested_aspect_ratio = _normalize_ratio_text(raw.get("aspect_ratio"))
    else:
        requested_aspect_ratio = "1:1"

    requested_image_size = str(raw.get("requested_image_size") or "").strip()
    if not requested_image_size:
        provider_settings = raw.get("provider_settings") if isinstance(raw.get("provider_settings"), dict) else {}
        if isinstance(provider_settings.get("image_size"), str) and provider_settings.get("image_size"):
            requested_image_size = str(provider_settings["image_size"]).strip()
        elif isinstance(provider_settings.get("image_resolution"), str) and provider_settings.get("image_resolution"):
            requested_image_size = str(provider_settings["image_resolution"]).strip()
        else:
            requested_image_size = "1K"

    if provider in {"openai", "xai", "novelai"}:
        requested_image_size = "1K"

    return {
        "prompt_type": raw.get("prompt_type"),
        "provider": provider,
        "model": str(raw.get("model") or "").strip(),
        "requested_aspect_ratio": requested_aspect_ratio,
        "requested_image_size": requested_image_size,
        "prompt": raw.get("prompt"),
        "positive_prompt": raw.get("positive_prompt"),
        "negative_prompt": raw.get("negative_prompt"),
        "provider_settings": sanitize_generation_settings(provider, raw.get("provider_settings")),
        "reference_images": raw.get("reference_images") if isinstance(raw.get("reference_images"), list) else None,
        "reference_objects": raw.get("reference_objects") if isinstance(raw.get("reference_objects"), list) else None,
    }


class ImageModelCatalogService:
    async def list_models(self, provider: str, provider_config: dict[str, Any]) -> list[dict[str, Any]]:
        if provider == "openrouter":
            return [record.to_api_dict() for record in await self._fetch_openrouter_models(provider_config)]
        records = STATIC_MODEL_RECORDS.get(provider, ())
        return [record.to_api_dict() for record in records]

    async def resolve_geometry(
        self,
        *,
        provider: str,
        model: str,
        requested_aspect_ratio: str,
        requested_image_size: str,
        provider_config: dict[str, Any] | None = None,
    ) -> ResolvedImageGeometry:
        record = await self._find_record(provider=provider, model=model, provider_config=provider_config or {})
        if record is None:
            raise ValueError(f"Unknown image provider '{provider}'")

        resolved_ratio = _pick_ratio(
            list(record.supported_aspect_ratios),
            requested_aspect_ratio or record.default_aspect_ratio,
            fallback=record.default_aspect_ratio,
        )

        supported_sizes = list(record.supported_image_sizes)
        resolved_image_size = str(requested_image_size or record.default_image_size).strip() or record.default_image_size
        if resolved_image_size not in supported_sizes:
            resolved_image_size = record.default_image_size

        if record.ui_resolution_mode == "translated_fixed":
            native_size_by_ratio = record.native_size_by_aspect_ratio or {}
            resolved_native_size = native_size_by_ratio.get(resolved_ratio) or next(iter(native_size_by_ratio.values()), "1024x1024")
        else:
            resolved_native_size = resolved_image_size

        effective_model = record.id or model
        if provider == "openrouter" and model:
            effective_model = model

        return ResolvedImageGeometry(
            model=effective_model,
            prompt_type=record.prompt_type,
            supports_image_input=record.supports_image_input,
            requested_aspect_ratio=_normalize_ratio_text(requested_aspect_ratio, fallback=resolved_ratio),
            requested_image_size=str(requested_image_size or resolved_image_size).strip() or resolved_image_size,
            resolved_aspect_ratio=resolved_ratio,
            resolved_image_size=resolved_image_size,
            resolved_native_size=resolved_native_size,
        )

    async def _find_record(self, *, provider: str, model: str, provider_config: dict[str, Any]) -> Optional[ImageModelRecord]:
        if provider == "openrouter":
            records = await self._fetch_openrouter_models(provider_config)
            if model:
                for record in records:
                    if record.id == model:
                        return record
            return self._build_openrouter_fallback_record(model)

        records = list(STATIC_MODEL_RECORDS.get(provider, ()))
        if not records:
            return None
        if model:
            for record in records:
                if record.id == model:
                    return record
        return records[0]

    async def _fetch_openrouter_models(self, provider_config: dict[str, Any]) -> list[ImageModelRecord]:
        if httpx is None:
            return []
        api_key = str(provider_config.get("api_key") or "").strip()
        if not api_key:
            return []

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://novelbuds.local",
            "X-Title": "Novel Buds",
        }
        additional_headers = provider_config.get("additional_headers")
        if isinstance(additional_headers, dict):
            for key, value in additional_headers.items():
                if isinstance(key, str) and isinstance(value, str):
                    headers[key] = value

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
        response.raise_for_status()
        payload = response.json()
        models = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(models, list):
            return []

        out: list[ImageModelRecord] = []
        for raw_model in models:
            record = self._normalize_openrouter_model(raw_model)
            if record is not None:
                out.append(record)
        out.sort(key=lambda item: item.name.lower())
        return out

    def _normalize_openrouter_model(self, raw_model: Any) -> Optional[ImageModelRecord]:
        if not isinstance(raw_model, dict):
            return None
        model_id = str(raw_model.get("id") or "").strip()
        if not model_id:
            return None

        architecture = raw_model.get("architecture") if isinstance(raw_model.get("architecture"), dict) else None
        input_modalities = [str(item).strip().lower() for item in architecture.get("input_modalities", [])] if architecture else []
        output_modalities = [str(item).strip().lower() for item in architecture.get("output_modalities", [])] if architecture else []
        if "image" not in output_modalities:
            return None

        geometry = OPENROUTER_IMAGE_MODEL_OVERRIDES.get(model_id, {})
        supported_aspect_ratios = tuple(
            geometry.get("supported_aspect_ratios", OPENROUTER_DEFAULT_RATIOS)
        )
        supported_image_sizes = tuple(
            geometry.get("supported_image_sizes", OPENROUTER_DEFAULT_IMAGE_SIZES)
        )
        pricing = raw_model.get("pricing") if isinstance(raw_model.get("pricing"), dict) else None

        return ImageModelRecord(
            id=model_id,
            name=str(raw_model.get("name") or model_id),
            description=str(raw_model.get("description") or "").strip() or None,
            canonical_slug=str(raw_model.get("canonical_slug") or raw_model.get("slug") or model_id),
            prompt_type="natural",
            supports_image_input="image" in input_modalities,
            supported_aspect_ratios=supported_aspect_ratios,
            supported_image_sizes=supported_image_sizes,
            default_aspect_ratio=supported_aspect_ratios[0],
            default_image_size=supported_image_sizes[0],
            ui_resolution_mode="native_tier",
            architecture={
                "input_modalities": input_modalities,
                "output_modalities": output_modalities,
            },
            pricing=pricing,
        )

    def _build_openrouter_fallback_record(self, model: str) -> ImageModelRecord:
        model_id = str(model or "").strip() or "openrouter/image-model"
        geometry = OPENROUTER_IMAGE_MODEL_OVERRIDES.get(model_id, {})
        supported_aspect_ratios = tuple(geometry.get("supported_aspect_ratios", OPENROUTER_DEFAULT_RATIOS))
        supported_image_sizes = tuple(geometry.get("supported_image_sizes", OPENROUTER_DEFAULT_IMAGE_SIZES))
        return ImageModelRecord(
            id=model_id,
            name=model_id,
            prompt_type="natural",
            supports_image_input=False,
            supported_aspect_ratios=supported_aspect_ratios,
            supported_image_sizes=supported_image_sizes,
            default_aspect_ratio=supported_aspect_ratios[0],
            default_image_size=supported_image_sizes[0],
            ui_resolution_mode="native_tier",
            canonical_slug=model_id,
        )


image_model_catalog_service = ImageModelCatalogService()
