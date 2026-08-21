from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Protocol
from uuid import UUID

from .grant_catalog import FeatureKey, ToolCategory


AutoApproveCategory = str
ToolExecutionPolicy = Literal["approval", "immediate"]


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    reason: str | None = None
    validator: str | None = None


if False:  # pragma: no cover
    from .contexts import ToolExecutionContext, ToolGroupExecutionContext, ToolModuleContext, ToolValidationContext


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    auto_approve_category: AutoApproveCategory | None = None
    execution_policy: ToolExecutionPolicy = "approval"
    ends_run: bool = False


@dataclass(frozen=True)
class ToolOffer:
    specs_by_name: dict[str, ToolSpec]
    bindings_by_name: dict[str, "ToolBinding"] = field(default_factory=dict)
    provider_tools: list[dict[str, Any]] = field(default_factory=list)
    auto_approve_category_by_name: dict[str, AutoApproveCategory] = field(default_factory=dict)


ToolOp = Literal[
    "read",
    "create",
    "replace",
    "patch",
    "delete",
    "translate",
    "patch_translation",
    "search",
    "call",
    "generate",
    "get_tree",
    "mcp",
]
TargetKind = Literal[
    "basic_info",
    "guidelines",
    "story_entity",
    "story_entity_folder",
    "outline",
    "manuscript",
    "timeline_track",
    "timeline_event",
    "project_tree",
    "sub_agent",
    "object_image",
    "scene_image",
    "mcp_tool",
]
ToolValidator = Callable[[dict[str, Any], "ToolValidationContext"], Any]
ToolExecutor = Callable[[dict[str, Any], "ToolExecutionContext"], Any]
PersistedMetaBuilder = Callable[["ToolModuleContext", dict[str, Any]], "PersistedToolMeta"]


@dataclass(frozen=True)
class ToolBindingMeta:
    feature_key: FeatureKey
    category: ToolCategory
    op: ToolOp
    target_kind: TargetKind


@dataclass(frozen=True)
class PersistedToolMeta:
    feature_key: FeatureKey
    category: ToolCategory
    op: ToolOp
    target_kind: TargetKind
    target_id: str | None
    merge_key: str | None


@dataclass(frozen=True)
class ToolExecutionOutcome:
    lifecycle: Literal["applied", "working", "failed"]
    result: dict[str, Any] | None = None
    reason: str | None = None
    extra_content_patch: dict[str, Any] | None = None
    child_thread_id: UUID | None = None
    child_input_text: str | None = None
    image_run_id: UUID | None = None


@dataclass(frozen=True)
class ToolBinding:
    spec: ToolSpec
    meta: ToolBindingMeta
    validate: ToolValidator
    execute: ToolExecutor
    build_persisted_meta: PersistedMetaBuilder
    include_in_catalog: bool = True


@dataclass(frozen=True)
class ToolDecisionItem:
    tool_call_id: UUID
    binding: ToolBinding
    args: dict[str, Any]
    meta: PersistedToolMeta
    call_seq: int


@dataclass(frozen=True)
class ToolDecisionGroup:
    feature_key: FeatureKey
    merge_key: str
    items: tuple[ToolDecisionItem, ...]


@dataclass(frozen=True)
class ToolExecutionResult:
    tool_call_id: UUID
    outcome: ToolExecutionOutcome


class ToolFeatureModule(ABC):
    feature_key: FeatureKey

    @abstractmethod
    def list_bindings(self, ctx: "ToolModuleContext") -> list[ToolBinding]:
        raise NotImplementedError

    async def apply_group(
        self,
        *,
        group: ToolDecisionGroup,
        ctx: "ToolGroupExecutionContext",
    ) -> list[ToolExecutionResult]:
        results: list[ToolExecutionResult] = []
        for item in group.items:
            outcome = await ctx.await_if_needed(item.binding.execute(item.args, ctx.to_execution_context(item.tool_call_id)))
            if not isinstance(outcome, ToolExecutionOutcome):
                raise ValueError(f"Invalid execution outcome for {item.binding.spec.name}")
            results.append(ToolExecutionResult(tool_call_id=item.tool_call_id, outcome=outcome))
        return results


class ToolFeatureModuleFactory(Protocol):
    def __call__(self) -> ToolFeatureModule:
        ...
