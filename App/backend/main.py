import logging
import mimetypes
import os
from pathlib import Path

from dotenv import load_dotenv

# Uvicorn only configures its own loggers; without this the app's loggers fall
# back to logging.lastResort and everything below WARNING is silently dropped.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from .auth import get_current_user
from .database import get_db
from .models.db_models import User
from .services.default_preset_seed import validate_default_preset_seed
from .services.demo_runtime import get_demo_runtime_config
from .services.asset_change_events import register_asset_change_event_hooks
from .services.object_change_events import register_object_change_event_hooks
from .services.asset_proxy import build_asset_proxy_response
from .services.chat_attachment_proxy import build_chat_attachment_proxy_response

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
from .routes.settings_routes import router as settings_router
from .routes.credential_routes import router as credential_router
from .routes.scenario_routes import router as scenario_router
from .routes.search_routes import router as search_router

# New unified translation system routes
from .routes.unified_object_routes import router as unified_object_router
from .routes.translation_routes import router as translation_router
from .routes.story_entity_tree_routes import router as story_entity_tree_router
from .routes.timeline_routes import router as timeline_router

# Asset management routes
from .routes.asset_routes import router as asset_router
from .routes.image_run_routes import router as image_run_router
from .routes.provider_routes import router as provider_router

# Fragment & folder management routes
from .routes.fragment_routes import router as fragment_router
from .routes.folder_routes import router as folder_router

# Template rendering/validation routes
from .routes.template_routes import router as template_router

# Variable management routes
from .routes.variable_routes import router as variable_router

# Preset management routes
from .routes.preset_routes import router as preset_router
from .routes.mcp_routes import router as mcp_router
from .routes.sub_agent_routes import router as sub_agent_router
from .routes.thread_routes import router as thread_router
from .routes.journey_routes import router as journey_router
from .routes.notification_routes import router as notification_router
from .routes.llm_request_routes import router as llm_request_router

# Token counting routes
from .routes.token_routes import router as token_router

# Account / Admin routes
from .routes.account_routes import router as account_router
from .routes.admin_routes import router as admin_router
from .routes.admin_memory_routes import router as admin_memory_router

load_dotenv()
validate_default_preset_seed()
get_demo_runtime_config()


def _normalized_app_domain() -> str:
    raw = str(os.getenv("APP_DOMAIN") or "").strip()
    if not raw:
        return ""
    normalized = raw.replace("https://", "").replace("http://", "").strip("/")
    return normalized


def _cors_allowed_origins() -> list[str]:
    origins = {
        "http://localhost:3000",
        "http://localhost:5173",
    }
    app_domain = _normalized_app_domain()
    if app_domain:
        origins.add(f"https://{app_domain}")
        if app_domain.startswith("www."):
            origins.add(f"https://{app_domain[4:]}")
        else:
            origins.add(f"https://www.{app_domain}")
    return sorted(origins)

app = FastAPI(
    title="Novel Buds API",
    version="2.0.0",
    description="Multi-provider LLM API with Database-backed Story Management for Novel Buds"
)

# Register SQLAlchemy session hooks for object:changed SSE batching.
register_object_change_event_hooks()
register_asset_change_event_hooks()

# Include all database API routers
app.include_router(auth_router)
app.include_router(project_router)
app.include_router(agent_router)
app.include_router(settings_router)
app.include_router(credential_router)
app.include_router(scenario_router)
app.include_router(search_router)

# Include new unified translation system routers
app.include_router(unified_object_router, prefix="/api/v1", tags=["objects"])
app.include_router(translation_router, prefix="/api/v1", tags=["translations"])
app.include_router(story_entity_tree_router)
app.include_router(timeline_router)

# Include asset management router
app.include_router(asset_router)
app.include_router(image_run_router)
app.include_router(provider_router)

# Include fragment & folder management routers
app.include_router(fragment_router)
app.include_router(folder_router)

# Include template rendering/validation router
app.include_router(template_router)

# Include variable management router
app.include_router(variable_router)

# Include preset management router
app.include_router(preset_router)
app.include_router(mcp_router)
app.include_router(sub_agent_router)
app.include_router(thread_router)
app.include_router(journey_router)
app.include_router(notification_router)
app.include_router(llm_request_router)

# Include token counting router
app.include_router(token_router)

# Account / Admin
app.include_router(account_router)
app.include_router(admin_router)

if os.getenv("ADMIN_MEMORY_DIAGNOSTICS_ENABLED", "0").lower() in {"1", "true"}:
    app.include_router(admin_memory_router)

@app.get("/storage/assets/{asset_key:path}", include_in_schema=False)
async def proxy_asset(
    asset_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return build_asset_proxy_response(asset_key, user_id=current_user.id, db=db)


@app.get("/storage/chat-attachments/{attachment_key:path}", include_in_schema=False)
async def proxy_chat_attachment(
    attachment_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return build_chat_attachment_proxy_response(attachment_key, user_id=current_user.id, db=db)

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
    allow_origins=_cors_allowed_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    """Health check endpoint"""
    return PlainTextResponse("ok")
