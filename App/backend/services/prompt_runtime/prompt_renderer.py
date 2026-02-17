from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from ...models.db_models import PromptFragment, PromptVersion
from ..template_engine import FragmentNotFoundError, create_environment, render_template
from ..variable_service import variable_service


class PromptTemplateNotFoundError(RuntimeError):
    pass


class PromptFragmentMissingError(RuntimeError):
    pass


class PromptVariableResolutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class PromptRenderInput:
    task_type: str
    prompt_name: str
    prompt_category: str
    project_data: dict[str, Any]
    extra_vars: dict[str, Any]


class PromptRenderer:
    def __init__(self, db: Session, user_id: UUID, preset_id: UUID):
        self._db = db
        self._user_id = user_id
        self._preset_id = preset_id

    def _load_prompt_content(self, *, task_type: str, prompt_category: str, prompt_name: str) -> str:
        prompt = (
            self._db.query(PromptVersion)
            .filter(
                and_(
                    PromptVersion.user_id == self._user_id,
                    PromptVersion.preset_id == self._preset_id,
                    PromptVersion.task_type == task_type,
                    PromptVersion.prompt_category == prompt_category,
                    PromptVersion.prompt_name == prompt_name,
                )
            )
            .order_by(desc(PromptVersion.version_number))
            .first()
        )
        if prompt is None or not isinstance(prompt.content, str) or not prompt.content.strip():
            raise PromptTemplateNotFoundError(
                f"Prompt template not found: {task_type}/{prompt_category}/{prompt_name}"
            )
        return prompt.content

    def _load_fragment_map(self) -> dict[str, str]:
        # Latest version per (folder_path, fragment_name)
        subq = (
            self._db.query(
                PromptFragment.folder_path,
                PromptFragment.fragment_name,
                func.max(PromptFragment.version_number).label("max_version"),
            )
            .filter(
                PromptFragment.user_id == self._user_id,
                PromptFragment.preset_id == self._preset_id,
            )
            .group_by(PromptFragment.folder_path, PromptFragment.fragment_name)
            .subquery()
        )

        rows = (
            self._db.query(PromptFragment)
            .join(
                subq,
                and_(
                    func.coalesce(PromptFragment.folder_path, "") == func.coalesce(subq.c.folder_path, ""),
                    PromptFragment.fragment_name == subq.c.fragment_name,
                    PromptFragment.version_number == subq.c.max_version,
                ),
            )
            .filter(
                PromptFragment.user_id == self._user_id,
                PromptFragment.preset_id == self._preset_id,
            )
            .all()
        )

        out: dict[str, str] = {}
        for row in rows:
            key = row.fragment_name if not row.folder_path else f"{row.folder_path}/{row.fragment_name}"
            out[key] = row.content
        return out

    def _build_template_data(self, *, project_data: dict[str, Any], extra_vars: dict[str, Any]) -> dict[str, Any]:
        try:
            user_vars = variable_service.get_variables_for_template(
                self._db,
                user_id=self._user_id,
                preset_id=self._preset_id,
            )
        except Exception as exc:
            raise PromptVariableResolutionError(str(exc)) from exc

        return {
            "project": project_data,
            "variables": user_vars,
            **(extra_vars or {}),
        }

    def _render(self, inp: PromptRenderInput) -> str:
        template_text = self._load_prompt_content(
            task_type=inp.task_type,
            prompt_category=inp.prompt_category,
            prompt_name=inp.prompt_name,
        )
        fragment_map = self._load_fragment_map()
        env = create_environment(fragment_map=fragment_map)

        try:
            return render_template(
                env,
                template_text,
                self._build_template_data(project_data=inp.project_data, extra_vars=inp.extra_vars),
            )
        except FragmentNotFoundError as exc:
            raise PromptFragmentMissingError(str(exc)) from exc

    def render_system_prompt(
        self,
        task_type: str,
        prompt_name: str,
        project_data: dict[str, Any],
        extra_vars: dict[str, Any],
    ) -> str:
        return self._render(
            PromptRenderInput(
                task_type=task_type,
                prompt_name=prompt_name,
                prompt_category="systemPrompt",
                project_data=project_data,
                extra_vars=extra_vars,
            )
        )

    def render_user_prompt(
        self,
        task_type: str,
        prompt_name: str,
        project_data: dict[str, Any],
        extra_vars: dict[str, Any],
    ) -> str:
        return self._render(
            PromptRenderInput(
                task_type=task_type,
                prompt_name=prompt_name,
                prompt_category="userPrompt",
                project_data=project_data,
                extra_vars=extra_vars,
            )
        )

    def render_memory_prompt(
        self,
        task_type: str,
        prompt_name: str,
        project_data: dict[str, Any],
        extra_vars: dict[str, Any],
    ) -> str:
        return self._render(
            PromptRenderInput(
                task_type=task_type,
                prompt_name=prompt_name,
                prompt_category="memoryPrompt",
                project_data=project_data,
                extra_vars=extra_vars,
            )
        )

    def render_prefill(
        self,
        task_type: str,
        prompt_name: str,
        project_data: dict[str, Any],
        extra_vars: dict[str, Any],
    ) -> str | None:
        try:
            rendered = self._render(
                PromptRenderInput(
                    task_type=task_type,
                    prompt_name=prompt_name,
                    prompt_category="prefill",
                    project_data=project_data,
                    extra_vars=extra_vars,
                )
            )
        except PromptTemplateNotFoundError:
            return None
        return rendered if rendered.strip() else None
