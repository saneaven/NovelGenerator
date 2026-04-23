from __future__ import annotations

import asyncio

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..models.requests import ChatCompletionRequest, ProviderModelsRequest
from ..providers.openrouter.llm import OpenRouterProvider
from ..providers.registry import create_llm_provider, list_embedding_models, list_llm_models, list_specs
from ..providers.shared.contracts import (
    MetaPayload,
    ProviderErrorPayload,
    delta_payload_to_wire,
    extract_native_tool_calls_from_snapshot,
    final_snapshot_to_wire,
    merge_meta_payload,
    patch_snapshot_with_meta,
)
from ..providers.shared.parsing.content_normalization import (
    StreamContentNormalizer,
    has_effective_delta,
    normalize_final_snapshot_content,
)
from ..providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ..providers.shared.project import to_public_provider_spec
from ..providers.shared.transport.sse_encoder import encode_sse
from ..providers.shared.transport.stream_retry import normalize_retry_config, stream_with_retry
from ..services.credential_service import CredentialServiceError, credential_service


router = APIRouter(tags=["providers"])


@router.get("/api/v1/providers")
async def list_providers():
    providers_info = []
    llm_specs = [spec for spec in list_specs() if spec.llm is not None]
    llm_specs.sort(key=lambda spec: spec.ui.llm_order if spec.ui.llm_order is not None else 999)

    for spec in llm_specs:
        providers_info.append(
            {
                "name": spec.id,
                "display_name": spec.ui.display_name_key,
                "display_name_key": spec.ui.display_name_key,
                "description_key": spec.ui.description_key,
                "capabilities": {
                    "chat": True,
                    "models": True,
                    "tools": bool(spec.llm.supports_tools),
                    "thinking": bool(spec.llm.supports_thinking),
                },
            }
        )

    return {"providers": providers_info}


@router.get("/api/v1/provider-specs")
async def get_provider_specs():
    providers = [to_public_provider_spec(spec) for spec in list_specs()]
    providers.sort(
        key=lambda item: (
            item["ui"]["llm_order"] if item["llm"] is not None and item["ui"]["llm_order"] is not None else 999,
            item["ui"]["embedding_order"] if item["embedding"] is not None and item["ui"]["embedding_order"] is not None else 999,
            item["ui"]["image_order"] if item["image"] is not None and item["ui"]["image_order"] is not None else 999,
            item["id"],
        )
    )
    return {"providers": providers}


@router.post("/api/v1/providers/{provider}/models")
async def get_models(
    provider: str,
    request: ProviderModelsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        return await list_llm_models(provider, provider_config, variant_hint=request.custom_kind)
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        message = str(exc)
        if message.startswith("Unknown provider"):
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/v1/providers/{provider}/embedding-models")
async def get_embedding_models(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    missing_credential: CredentialServiceError | None = None
    try:
        try:
            provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        except CredentialServiceError as exc:
            missing_credential = exc
            provider_config = {}
        return await list_embedding_models(provider, provider_config)
    except ValueError as exc:
        message = str(exc)
        if message.startswith("Unknown provider"):
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        if missing_credential is not None:
            raise HTTPException(status_code=400, detail=str(missing_credential)) from exc
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/v1/chat/completions/{provider}/stream")
async def stream_chat(
    provider: str,
    request: ChatCompletionRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        if request.native_tool_call and request.tools:
            raise HTTPException(status_code=400, detail="native_tool_call requires tools to be omitted")

        provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        provider_instance = create_llm_provider(
            provider,
            provider_config,
            variant_hint=request.custom_kind,
        )
        if not provider_instance.validate_config():
            raise HTTPException(status_code=400, detail=f"Invalid configuration for provider '{provider}'")

        messages: list[dict] = []
        for msg in request.messages:
            message_dict: dict = {
                "role": msg.role,
                "content_parts": [part.model_dump() for part in msg.content_parts],
            }
            if msg.tool_calls:
                message_dict["tool_calls"] = [tool_call.model_dump(exclude_none=True) for tool_call in msg.tool_calls]
            if msg.tool_results:
                message_dict["tool_results"] = [tool_result.model_dump() for tool_result in msg.tool_results]
            messages.append(message_dict)

        async def event_gen():
            provider_pref = request.provider_preference.model_dump(exclude_none=True) if request.provider_preference else None
            thinking_cfg = request.thinking_config.model_dump(exclude_none=True) if request.thinking_config else None
            retry_cfg = normalize_retry_config(request.retry_config.model_dump() if request.retry_config else None)

            def _create_stream():
                return provider_instance.stream_chat(
                    messages=messages,
                    model=request.model,
                    temperature=request.temperature,
                    tools=request.tools,
                    tool_choice=request.tool_choice,
                    max_tokens=request.max_tokens,
                    provider_preference=provider_pref,
                    thinking_config=thinking_cfg,
                    thinking_mode=request.thinking_mode,
                    custom_kind=request.custom_kind,
                    native_tool_call=request.native_tool_call,
                    verbosity=request.verbosity,
                    provider_settings=request.provider_settings,
                )

            stream = stream_with_retry(_create_stream, retry_cfg)
            seq = 0
            native_final = None
            merged_meta: MetaPayload | None = None
            assembler = FallbackSnapshotAssembler(provider=provider, model=request.model)
            content_normalizer = StreamContentNormalizer()

            try:
                async for event in stream:
                    if await req.is_disconnected():
                        break

                    if event.kind == "delta" and event.delta is not None:
                        delta = content_normalizer.normalize_delta(event.delta)
                        assembler.apply_delta(delta)
                        if not has_effective_delta(delta):
                            continue
                        seq += 1
                        yield encode_sse("delta", delta_payload_to_wire(seq, delta))
                        continue

                    if event.kind == "meta" and event.meta is not None:
                        assembler.apply_meta(event.meta)
                        merged_meta = merge_meta_payload(merged_meta, event.meta)
                        continue

                    if event.kind == "final_native" and event.final_native is not None:
                        if native_final is not None:
                            raise ValueError("Provider emitted multiple native final snapshots")
                        native_final = event.final_native
                        continue

                    if event.kind == "error":
                        err = event.error or ProviderErrorPayload(message="Unknown provider error", status=None)
                        yield encode_sse("error", {"message": err.message, "status": err.status})
                        yield encode_sse("done", {"ok": False})
                        return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if not await req.is_disconnected():
                    yield encode_sse("error", {"message": str(exc), "status": getattr(exc, "status_code", None)})
                    yield encode_sse("done", {"ok": False})
                return
            finally:
                if hasattr(stream, "aclose"):
                    await stream.aclose()
                await provider_instance.aclose()

            if await req.is_disconnected():
                return

            try:
                if native_final is not None:
                    final_snapshot = patch_snapshot_with_meta(native_final, merged_meta)
                else:
                    final_snapshot = assembler.finalize_or_raise()

                if request.native_tool_call:
                    final_snapshot = extract_native_tool_calls_from_snapshot(final_snapshot)
                final_snapshot = normalize_final_snapshot_content(final_snapshot)

                yield encode_sse("final", {"snapshot": final_snapshot_to_wire(final_snapshot)})
                yield encode_sse("done", {"ok": True})
            except Exception as exc:
                yield encode_sse("error", {"message": str(exc), "status": getattr(exc, "status_code", None)})
                yield encode_sse("done", {"ok": False})

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )
    except HTTPException:
        raise
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        message = str(exc)
        if message.startswith("Unknown provider"):
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/v1/providers/openrouter/models/{canonical_slug:path}/endpoints")
async def get_openrouter_model_endpoints(
    canonical_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        provider_config = credential_service.get_provider_config(db, current_user.id, "openrouter")
        api_key = str(provider_config.get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="Credential for provider 'openrouter' not found")

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

        url = f"https://openrouter.ai/api/v1/models/{canonical_slug}/endpoints"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)

        if response.status_code >= 400:
            detail = response.text or f"OpenRouter request failed ({response.status_code})"
            raise HTTPException(status_code=response.status_code, detail=detail)

        return OpenRouterProvider.annotate_endpoints_payload_for_ui(response.json())
    except HTTPException:
        raise
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
