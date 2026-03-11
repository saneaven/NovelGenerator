from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Protocol


AutoApproveCategory = str


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    reason: str | None = None
    validator: str | None = None


if False:  # pragma: no cover
    from .contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    auto_approve_category: AutoApproveCategory | None


@dataclass(frozen=True)
class ToolOffer:
    specs_by_name: dict[str, ToolSpec]
    provider_tools: list[dict[str, Any]]
    auto_approve_category_by_name: dict[str, AutoApproveCategory]


class ToolCallModule(ABC):
    prefix: str = ""
    dynamic: bool = False

    def list_auto_approve_categories(self) -> tuple[AutoApproveCategory, ...]:
        return ()

    @abstractmethod
    def list_tools(self, ctx: "ToolModuleContext") -> list[ToolSpec]:
        raise NotImplementedError

    def resolve_tool(self, tool_name: str, ctx: "ToolModuleContext") -> ToolSpec | None:
        for spec in self.list_tools(ctx):
            if spec.name == tool_name:
                return spec
        return None

    @abstractmethod
    async def validate(self, tool_name: str, args: dict[str, Any], ctx: "ToolValidationContext") -> ValidationResult:
        raise NotImplementedError

    @abstractmethod
    async def execute(self, tool_name: str, args: dict[str, Any], ctx: "ToolExecutionContext") -> dict[str, Any]:
        raise NotImplementedError


class ToolModuleFactory(Protocol):
    def __call__(self) -> ToolCallModule:
        ...
