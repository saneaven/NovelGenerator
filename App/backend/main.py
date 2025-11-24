from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse
from .models.requests import ChatCompletionRequest, ProviderConfig
from .providers.registry import ProviderRegistry
from .providers.copilot import CopilotProvider
from .providers.openrouter import OpenRouterProvider
from .providers.custom import CustomOpenAIProvider

# Import database API routes
from .routes.auth_routes import router as auth_router
from .routes.project_routes import router as project_router
from .routes.chat_routes import router as chat_router
from .routes.settings_routes import router as settings_router
from .routes.prompt_routes import router as prompt_router

# New unified translation system routes
from .routes.unified_object_routes import router as unified_object_router
from .routes.translation_routes import router as translation_router

load_dotenv()

app = FastAPI(
    title="Novel Generator API",
    version="2.0.0",
    description="Multi-provider LLM API with Database-backed Story Management for Novel Generator"
)

# Include all database API routers
app.include_router(auth_router)
app.include_router(project_router)
app.include_router(chat_router)
app.include_router(settings_router)
app.include_router(prompt_router)

# Include new unified translation system routers
app.include_router(unified_object_router, prefix="/api/v1", tags=["objects"])
app.include_router(translation_router, prefix="/api/v1", tags=["translations"])

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
            "supports": ["chat", "models", "functions"]
        }

        if provider_name == "copilot":
            metadata["requires_api_key"] = False
            metadata["description"] = "GitHub Copilot API (server-configured)"
        elif provider_name == "openrouter":
            metadata["requires_api_key"] = True
            metadata["description"] = "OpenRouter unified LLM API"
        elif provider_name == "custom":
            metadata["requires_api_key"] = True
            metadata["requires_base_url"] = True
            metadata["description"] = "Custom OpenAI-compatible endpoint"

        providers_info.append(metadata)

    return {"providers": providers_info}


@app.post("/api/v1/providers/{provider}/models")
async def get_models(provider: str, config: ProviderConfig):
    """Get available models for a specific provider"""
    try:
        provider_instance = ProviderRegistry.get_provider(
            provider,
            config.model_dump()
        )

        if not provider_instance.validate_config():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid configuration for provider '{provider}'"
            )

        models_data = await provider_instance.get_models()
        return models_data

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/chat/completions/{provider}/stream")
async def stream_chat(provider: str, request: ChatCompletionRequest):
    """Stream chat completions from specified provider"""
    try:
        provider_instance = ProviderRegistry.get_provider(
            provider,
            request.config.model_dump()
        )

        if not provider_instance.validate_config():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid configuration for provider '{provider}'"
            )

        # Convert messages to dict format with content field for LLM providers
        messages = [
            {
                "role": msg.role,
                "content": msg.get_content_text()
            }
            for msg in request.messages
        ]

        async def event_gen():
            # Prepare provider preference for OpenRouter
            provider_pref = None
            if provider == "openrouter" and request.provider_preference:
                provider_pref = request.provider_preference.model_dump(exclude_none=True)

            # Prepare thinking config for OpenRouter
            thinking_cfg = None
            if provider == "openrouter" and request.thinking_config:
                thinking_cfg = request.thinking_config.model_dump(exclude_none=True)

            async for chunk in provider_instance.stream_chat(
                messages=messages,
                model=request.model,
                temperature=request.temperature,
                functions=request.functions,
                max_tokens=request.max_tokens,
                provider_preference=provider_pref,
                thinking_config=thinking_cfg,
                thinking_mode=request.thinking_mode
            ):
                yield chunk

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/healthz")
def healthz():
    """Health check endpoint"""
    return PlainTextResponse("ok")
