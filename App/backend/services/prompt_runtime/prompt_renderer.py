from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from ...models.db_models import PromptFragment, PromptVersion
from ..folder_service import FolderService
from ..template_engine import FragmentNotFoundError, create_environment, render_template


class PromptTemplateNotFoundError(RuntimeError):
    pass


class PromptFragmentMissingError(RuntimeError):
    pass


class PromptVariableResolutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class PromptRenderInput:
    task_type: str
    task_subtype: str  # planMode, agentMode, object, etc.
    prompt_category: str  # systemPrompt, userPrompt, prefill, etc.
    template_data: dict[str, Any]


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


class PromptRenderer:
    def __init__(self, db: Session, user_id: UUID, preset_id: UUID):
        self._db = db
        self._user_id = user_id
        self._preset_id = preset_id

    def _load_prompt_content(self, *, task_type: str, task_subtype: str, prompt_category: str) -> str:
        prompt = (
            self._db.query(PromptVersion)
            .filter(
                and_(
                    PromptVersion.user_id == self._user_id,
                    PromptVersion.preset_id == self._preset_id,
                    PromptVersion.task_type == task_type,
                    PromptVersion.prompt_category == prompt_category,
                    PromptVersion.task_subtype == task_subtype,
                )
            )
            .order_by(desc(PromptVersion.version_number))
            .first()
        )
        if prompt is None or not isinstance(prompt.content, str) or not prompt.content.strip():
            raise PromptTemplateNotFoundError(
                f"Prompt template not found: {task_type}/{task_subtype}/{prompt_category}"
            )
        return prompt.content

    def _load_fragment_map(self) -> dict[str, str]:
        return load_user_fragment_map(self._db, self._user_id, self._preset_id)

    def _render(self, inp: PromptRenderInput) -> str:
        template_text = self._load_prompt_content(
            task_type=inp.task_type,
            task_subtype=inp.task_subtype,
            prompt_category=inp.prompt_category,
        )
        fragment_map = self._load_fragment_map()
        env = create_environment(fragment_map=fragment_map)

        try:
            return render_template(
                env,
                template_text,
                inp.template_data,
            )
        except FragmentNotFoundError as exc:
            raise PromptFragmentMissingError(str(exc)) from exc

    def render_prompt(
        self,
        *,
        task_type: str,
        task_subtype: str,
        prompt_category: str,
        template_data: dict[str, Any],
    ) -> str:
        return self._render(
            PromptRenderInput(
                task_type=task_type,
                task_subtype=task_subtype,
                prompt_category=prompt_category,
                template_data=template_data,
            )
        )

    def render_system_prompt(
        self,
        task_type: str,
        task_subtype: str,
        template_data: dict[str, Any],
    ) -> str:
        return self.render_prompt(
            task_type=task_type,
            task_subtype=task_subtype,
            prompt_category="systemPrompt",
            template_data=template_data,
        )

    def render_user_prompt(
        self,
        task_type: str,
        task_subtype: str,
        template_data: dict[str, Any],
    ) -> str:
        return self.render_prompt(
            task_type=task_type,
            task_subtype=task_subtype,
            prompt_category="userPrompt",
            template_data=template_data,
        )

    def render_memory_prompt(
        self,
        task_type: str,
        task_subtype: str,
        template_data: dict[str, Any],
    ) -> str:
        return self.render_prompt(
            task_type=task_type,
            task_subtype=task_subtype,
            prompt_category="memoryPrompt",
            template_data=template_data,
        )

    def render_prefill(
        self,
        task_type: str,
        task_subtype: str,
        template_data: dict[str, Any],
    ) -> str | None:
        try:
            rendered = self.render_prompt(
                task_type=task_type,
                task_subtype=task_subtype,
                prompt_category="prefill",
                template_data=template_data,
            )
        except PromptTemplateNotFoundError:
            return None
        return rendered if rendered.strip() else None
