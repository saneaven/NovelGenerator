from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Protocol


ToolSetName = Literal[
    "agent_plan_mode",
    "agent_agent_mode",
    "manuscript",
    "storyObject",
    "outline",
    "objectTranslation",
]

AutoApproveCategory = Literal["read", "search", "create", "delete", "replace", "patch", "subAgent"]


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    reason: str | None = None
    validator: str | None = None


if False:  # pragma: no cover
    from .contexts import ToolExecutionContext, ToolOfferContext, ToolValidationContext


ToolValidator = Callable[[dict[str, Any], "ToolValidationContext"], ValidationResult | Awaitable[ValidationResult]]
ToolExecutor = Callable[[dict[str, Any], "ToolExecutionContext"], Awaitable[dict[str, Any]]]
ToolEnabledPredicate = Callable[["ToolOfferContext"], bool]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    tool_sets: frozenset[ToolSetName]
    auto_approve_category: AutoApproveCategory | None
    validators: tuple[ToolValidator, ...]
    executor: ToolExecutor
    enabled_when: ToolEnabledPredicate | None = None


@dataclass(frozen=True)
class ToolOffer:
    tool_set_name: ToolSetName
    specs_by_name: dict[str, ToolSpec]
    provider_tools: list[dict[str, Any]]
    auto_approve_category_by_name: dict[str, AutoApproveCategory]


class ToolProvider(Protocol):
    def build_specs(self, ctx: "ToolOfferContext") -> list[ToolSpec]:
        ...
