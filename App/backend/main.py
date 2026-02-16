import asyncio
import mimetypes
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from .models.requests import ChatCompletionRequest, ProviderModelsRequest
from .providers.registry import ProviderRegistry
from .providers.openrouter import OpenRouterProvider
from .providers.custom import CustomProvider
from .providers.claude_provider import ClaudeProvider
from .providers.gemini_provider import GeminiProvider
from .providers.openai_responses_provider import OpenAIResponsesProvider
from .providers.xai_provider import XAIProvider
from .providers.contracts import (
    MetaPayload,
    ProviderErrorPayload,
    final_snapshot_to_wire,
    delta_payload_to_wire,
    merge_meta_payload,
    patch_snapshot_with_meta,
    extract_native_tool_calls_from_snapshot,
)
from .providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from .providers.sse_encoder import encode_sse
from .auth import get_current_user
from .database import get_db
from .models.db_models import User
from .services.credential_service import CredentialServiceError, credential_service
from .services.embedding_models_service import list_embedding_models

# Ensure correct Content-Type for AVIF assets when served via StaticFiles.
mimetypes.add_type("image/avif", ".avif")


class CachedStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            response.headers.setdefault("cache-control", self.cache_control)
        return response

# Import database API routes
from .routes.auth_routes import router as auth_router
from .routes.project_routes import router as project_router
from .routes.agent_routes import router as agent_router
from .routes.memory_routes import router as memory_router
from .routes.settings_routes import router as settings_router
from .routes.credential_routes import router as credential_router
from .routes.prompt_routes import router as prompt_router
from .routes.rag_routes import router as rag_router

# New unified translation system routes
from .routes.unified_object_routes import router as unified_object_router
from .routes.translation_routes import router as translation_router

# Asset management routes
from .routes.asset_routes import router as asset_router

# Fragment management routes
from .routes.fragment_routes import router as fragment_router

# Variable management routes
from .routes.variable_routes import router as variable_router

# Preset management routes
from .routes.preset_routes import router as preset_router
from .routes.sub_agent_routes import router as sub_agent_router
from .routes.thread_routes import router as thread_router

# Token counting routes
from .routes.token_routes import router as token_router

# Account / Admin routes
from .routes.account_routes import router as account_router
from .routes.admin_routes import router as admin_router

load_dotenv()

app = FastAPI(
    title="Novel Buds API",
    version="2.0.0",
    description="Multi-provider LLM API with Database-backed Story Management for Novel Buds"
)

# Include all database API routers
app.include_router(auth_router)
app.include_router(project_router)
app.include_router(agent_router)
app.include_router(memory_router)
app.include_router(settings_router)
app.include_router(credential_router)
app.include_router(prompt_router)
app.include_router(rag_router)

# Include new unified translation system routers
app.include_router(unified_object_router, prefix="/api/v1", tags=["objects"])
app.include_router(translation_router, prefix="/api/v1", tags=["translations"])

# Include asset management router
app.include_router(asset_router)

# Include fragment management router
app.include_router(fragment_router)

# Include variable management router
app.include_router(variable_router)

# Include preset management router
app.include_router(preset_router)
app.include_router(sub_agent_router)
app.include_router(thread_router)

# Include token counting router
app.include_router(token_router)

# Account / Admin
app.include_router(account_router)
app.include_router(admin_router)

# Mount static files for asset storage
storage_path = Path(__file__).parent / "storage" / "assets"
storage_path.mkdir(parents=True, exist_ok=True)
app.mount("/storage/assets", StaticFiles(directory=str(storage_path)), name="assets")

# Mount static files for resources (landing page images, etc.)
resources_path = Path(__file__).parent / "storage" / "resources"
resources_path.mkdir(parents=True, exist_ok=True)
app.mount(
    "/storage/resources",
    CachedStaticFiles(directory=str(resources_path), cache_control="public, max-age=1800"),
    name="resources",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/providers")
async def list_providers():
    """List all available LLM providers"""
    providers_info = []

    for provider_dict in ProviderRegistry.list_providers():
        provider_name = provider_dict["name"]

        # Add metadata for each provider
        metadata = {
            "name": provider_name,
            "display_name": provider_dict["display_name"],
            "capabilities": {
                "chat": True,
                "models": True,
                "tools": provider_name in {"openrouter", "custom", "gemini", "claude"},
                "thinking": provider_name in {"openrouter", "claude", "gemini", "custom"}
            }
        }

        if provider_name == "openrouter":
            metadata["requires_api_key"] = True
            metadata["description"] = "OpenRouter unified LLM API"
        elif provider_name == "custom":
            metadata["requires_api_key"] = True
            metadata["requires_base_url"] = True
            metadata["description"] = "Custom OpenAI-compatible endpoint"
        elif provider_name == "claude":
            metadata["requires_api_key"] = True
            metadata["description"] = "Anthropic Claude with extended thinking"
        elif provider_name == "gemini":
            metadata["requires_api_key"] = True
            metadata["description"] = "Google Gemini with thought summaries"

        providers_info.append(metadata)

    return {"providers": providers_info}


@app.post("/api/v1/providers/{provider}/models")
async def get_models(
    provider: str,
    request: ProviderModelsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get available models for a specific provider"""
    try:
        provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        if provider == "custom":
            provider_config["request_format"] = request.request_format or "openai_sdk"

        provider_instance = ProviderRegistry.get_provider(provider, provider_config)

        # All providers now require API key for model listing
        if not provider_instance.validate_config():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid configuration for provider '{provider}'"
            )

        models_data = await provider_instance.get_models()
        return models_data

    except HTTPException:
        raise
    except CredentialServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        message = str(e)
        if message.startswith("Unknown provider"):
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/providers/{provider}/embedding-models")
async def get_embedding_models(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get available embedding models for a specific provider."""
    try:
        config = credential_service.get_provider_config(db, current_user.id, provider)
        provider_instance = ProviderRegistry.get_provider(
            provider,
            config,
        )

        # Keep parity with /models: require a valid provider configuration to list.
        if not provider_instance.validate_config():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid configuration for provider '{provider}'",
            )

        return await list_embedding_models(provider=provider, config=config)
    except HTTPException:
        raise
    except CredentialServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        message = str(e)
        if message.startswith("Unknown provider"):
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/chat/completions/{provider}/stream")
async def stream_chat(
    provider: str,
    request: ChatCompletionRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream chat completions from specified provider"""
    try:
        if request.native_tool_call and request.tools:
            raise HTTPException(
                status_code=400,
                detail="native_tool_call requires tools to be omitted",
            )

        provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        if provider == "custom":
            provider_config = {
                **provider_config,
                "request_format": request.request_format or "openai_sdk",
            }

        provider_instance = ProviderRegistry.get_provider(
            provider,
            provider_config
        )

        if not provider_instance.validate_config():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid configuration for provider '{provider}'"
            )

        # Convert messages to dict format with content field for LLM providers
        messages = []
        for msg in request.messages:
            message_dict: dict = {
                "role": msg.role,
                "content": msg.get_content_text()
            }
            # Include tool_calls for assistant messages if present
            if msg.tool_calls:
                message_dict["tool_calls"] = [tc.model_dump(exclude_none=True) for tc in msg.tool_calls]
            # Include tool_results for tool_results role messages
            if msg.tool_results:
                message_dict["tool_results"] = [tr.model_dump() for tr in msg.tool_results]
            messages.append(message_dict)

        async def event_gen():
            # Prepare provider preference for OpenRouter
            provider_pref = request.provider_preference.model_dump(exclude_none=True) if request.provider_preference else None

            # Thinking config is provider-agnostic; each provider maps fields they understand
            thinking_cfg = request.thinking_config.model_dump(exclude_none=True) if request.thinking_config else None

            # Retry config for error handling
            retry_cfg = request.retry_config.model_dump() if request.retry_config else None

            stream = provider_instance.stream_chat(
                messages=messages,
                model=request.model,
                temperature=request.temperature,
                tools=request.tools,
                tool_choice=request.tool_choice,
                max_tokens=request.max_tokens,
                provider_preference=provider_pref,
                thinking_config=thinking_cfg,
                thinking_mode=request.thinking_mode,
                thinking_format=request.thinking_format,
                request_format=request.request_format,
                retry_config=retry_cfg,
                native_tool_call=request.native_tool_call,
            )

            seq = 0
            native_final = None
            merged_meta: MetaPayload | None = None
            assembler = FallbackSnapshotAssembler(provider=provider, model=request.model)

            try:
                async for event in stream:
                    # Check if client disconnected
                    if await req.is_disconnected():
                        print("Client disconnected, stopping stream")
                        break

                    if event.kind == "delta" and event.delta is not None:
                        seq += 1
                        assembler.apply_delta(event.delta)
                        yield encode_sse("delta", delta_payload_to_wire(seq, event.delta))
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
                print("Stream cancelled due to client disconnect")
                raise  # Re-raise to let FastAPI handle cleanup
            except Exception as exc:
                if not await req.is_disconnected():
                    yield encode_sse("error", {"message": str(exc), "status": getattr(exc, "status_code", None)})
                    yield encode_sse("done", {"ok": False})
                return
            finally:
                # Ensure generator is closed
                if hasattr(stream, 'aclose'):
                    await stream.aclose()

            if await req.is_disconnected():
                return

            try:
                if native_final is not None:
                    final_snapshot = patch_snapshot_with_meta(native_final, merged_meta)
                else:
                    final_snapshot = assembler.finalize_or_raise()

                if request.native_tool_call:
                    final_snapshot = extract_native_tool_calls_from_snapshot(final_snapshot)

                yield encode_sse("final", {"snapshot": final_snapshot_to_wire(final_snapshot)})
                yield encode_sse("done", {"ok": True})
            except Exception as exc:
                yield encode_sse("error", {"message": str(exc), "status": getattr(exc, "status_code", None)})
                yield encode_sse("done", {"ok": False})
                return

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            }
        )

    except HTTPException:
        raise
    except CredentialServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        message = str(e)
        if message.startswith("Unknown provider"):
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/providers/openrouter/models/{canonical_slug:path}/endpoints")
async def get_openrouter_model_endpoints(
    canonical_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Proxy OpenRouter model endpoint info with server-side credential resolution."""
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

        return response.json()
    except HTTPException:
        raise
    except CredentialServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/healthz")
def healthz():
    """Health check endpoint"""
    return PlainTextResponse("ok")
