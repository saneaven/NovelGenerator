from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ...models.db_models import PromptFragment
from ..folder_service import FolderService
from ..template_engine import create_environment, render_template


class TemplateRenderer:
    """String-only Jinja2 renderer with user fragment support."""

    def __init__(self, *, fragment_map: dict[str, str]):
        self._fragment_map = fragment_map if isinstance(fragment_map, dict) else {}
        self._env = create_environment(fragment_map=self._fragment_map)

    def render_text(self, template_text: str, template_data: dict[str, Any]) -> str:
        return render_template(self._env, template_text or "", template_data if isinstance(template_data, dict) else {})


def load_user_fragment_map(db: Session, user_id: UUID, preset_id: UUID) -> dict[str, str]:
    """Load the latest version of every fragment for a user+preset from the DB."""
    subq = (
        db.query(
            PromptFragment.folder_id,
            PromptFragment.fragment_name,
            func.max(PromptFragment.version_number).label("max_version"),
        )
        .filter(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
        )
        .group_by(PromptFragment.folder_id, PromptFragment.fragment_name)
        .subquery()
    )

    rows = (
        db.query(PromptFragment)
        .join(
            subq,
            and_(
                PromptFragment.folder_id.is_not_distinct_from(subq.c.folder_id),
                PromptFragment.fragment_name == subq.c.fragment_name,
                PromptFragment.version_number == subq.c.max_version,
            ),
        )
        .filter(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
        )
        .all()
    )

    path_cache = FolderService.build_folder_path_cache(db, preset_id)

    out: dict[str, str] = {}
    for row in rows:
        if row.folder_id and row.folder_id in path_cache:
            key = f"{path_cache[row.folder_id]}/{row.fragment_name}"
        else:
            key = row.fragment_name
        out[key] = row.content
    return out
