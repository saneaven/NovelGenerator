"""API routes for template rendering and validation"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.templates import (
    TemplateRenderRequest,
    TemplateRenderResponse,
    TemplateValidateRequest,
    TemplateValidateResponse,
)
from ..services.prompt_runtime.prompt_renderer import load_user_fragment_map
from ..services.template_engine import create_environment, render_template

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])


def get_active_preset_id(current_user: User) -> uuid.UUID:
    """Get active preset ID from user settings, raise 400 if not set"""
    if not current_user.settings or not current_user.settings.active_preset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active preset set. Please select or create a preset first."
        )
    return current_user.settings.active_preset_id


@router.post("/render", response_model=TemplateRenderResponse)
async def render_template_preview(
    data: TemplateRenderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Render a Jinja2 template using the same pipeline as production."""
    preset_id = get_active_preset_id(current_user)
    fragment_map = load_user_fragment_map(db, current_user.id, preset_id)
    env = create_environment(fragment_map=fragment_map)
    try:
        rendered = render_template(env, data.template_content, data.data)
        return TemplateRenderResponse(rendered=rendered)
    except Exception as e:
        return TemplateRenderResponse(error=str(e))


@router.post("/validate", response_model=TemplateValidateResponse)
async def validate_template(
    data: TemplateValidateRequest,
    current_user: User = Depends(get_current_user),
):
    """Validate Jinja2 template syntax without rendering."""
    env = create_environment()
    try:
        env.parse(data.template_content)
        return TemplateValidateResponse(is_valid=True)
    except Exception as e:
        return TemplateValidateResponse(is_valid=False, error=str(e))
