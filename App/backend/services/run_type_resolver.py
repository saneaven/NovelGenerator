from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import RunModel, SubAgentDefinitionModel
from .settings_service import TaskConfig, settings_service
from .tool_schemas import ToolSchemaDef, get_dynamic_call_tools, get_tools_for_set


@dataclass
class HandlerDefaultOptions:
    create_new_version: bool
    user_request: str


@dataclass
class ResolvedRunConfig:
    llm_mode: str
    task_type: str
    provider: str
    provider_config: dict[str, Any]
    model: str
    temperature: float
    max_output_tokens: int | None
    thinking_mode: str
    thinking_config: dict[str, Any] | None
    thinking_format: str | None
    request_format: str | None
    retry_config: dict[str, Any] | None
    tools: list[ToolSchemaDef]
    allowed_tool_names: list[str]
    memory_enabled: bool
    history_strategy: str
    handler_default_options: HandlerDefaultOptions
    preset_id: UUID | None


class RunTypeResolver:
    def _task_config_to_fields(self, task_cfg: TaskConfig) -> tuple[str, float, int | None, str, dict[str, Any] | None, str | None, str | None]:
        advanced = task_cfg.advanced if isinstance(task_cfg.advanced, dict) else {}
        thinking_mode = str(advanced.get("thinking_mode") or "off")
        thinking_cfg = advanced.get("thinking_config") if isinstance(advanced.get("thinking_config"), dict) else None
        thinking_format = advanced.get("thinking_format") if isinstance(advanced.get("thinking_format"), str) else None
        request_format = advanced.get("request_format") if isinstance(advanced.get("request_format"), str) else None
        return (
            task_cfg.model,
            task_cfg.temperature,
            task_cfg.max_output_tokens,
            thinking_mode,
            thinking_cfg,
            thinking_format,
            request_format,
        )

    async def resolve(self, db: Session, run: RunModel, user_id: UUID) -> ResolvedRunConfig:
        rag_settings = settings_service.get_rag_settings(db, user_id)
        preset_id = settings_service.get_active_preset_id(db, user_id)
        retry_config = settings_service.get_retry_config(db, user_id)

        # Defaults
        task_type = "agent"
        llm_mode = "agent:agentMode"
        tools: list[ToolSchemaDef] = []
        memory_enabled = False
        history_strategy = "none"
        handler_default = HandlerDefaultOptions(create_new_version=True, user_request="AI Edit")

        if run.run_type == "agent":
            task_type = "agent"
            llm_mode = f"agent:{run.run_mode}"
            set_name = "agent_plan_mode" if run.run_mode == "planMode" else "agent_agent_mode"
            dynamic = []
            if preset_id is not None and run.run_mode == "agentMode":
                dynamic = get_dynamic_call_tools(db, user_id=user_id, preset_id=preset_id)
            tools = get_tools_for_set(
                set_name,
                rag_search_enabled=rag_settings.enabled,
                dynamic_call_tools=dynamic,
                include_return_sub_agent_result=False,
            )
            memory_enabled = True
            history_strategy = "agent_root"
            handler_default = HandlerDefaultOptions(create_new_version=True, user_request="AI Edit")

            task_cfg = settings_service.get_task_config(db, user_id, "agent")
            model, temp, max_tokens, thinking_mode, thinking_cfg, thinking_format, request_format = self._task_config_to_fields(task_cfg)
            return ResolvedRunConfig(
                llm_mode=llm_mode,
                task_type=task_type,
                provider=task_cfg.provider,
                provider_config={},
                model=model,
                temperature=temp,
                max_output_tokens=max_tokens,
                thinking_mode=thinking_mode,
                thinking_config=thinking_cfg,
                thinking_format=thinking_format,
                request_format=request_format,
                retry_config=retry_config,
                tools=tools,
                allowed_tool_names=[t.name for t in tools],
                memory_enabled=memory_enabled,
                history_strategy=history_strategy,
                handler_default_options=handler_default,
                preset_id=preset_id,
            )

        if run.run_type == "subAgent":
            if run.sub_agent_id is None:
                raise ValueError("subAgent run is missing sub_agent_id")
            if preset_id is None:
                raise ValueError("No active preset for subAgent run")

            sub_agent = (
                db.query(SubAgentDefinitionModel)
                .filter(
                    SubAgentDefinitionModel.user_id == user_id,
                    SubAgentDefinitionModel.preset_id == preset_id,
                    SubAgentDefinitionModel.id == run.sub_agent_id,
                )
                .first()
            )
            if sub_agent is None:
                raise ValueError("Sub agent definition not found")

            llm_mode = f"subAgent:{sub_agent.agent_name}"
            task_type = "subAgent"

            # Static allowed tools from definition
            allowed_static = sub_agent.allowed_tool_names if isinstance(sub_agent.allowed_tool_names, list) else []
            base_tools = [tool for tool in get_tools_for_set("agent_agent_mode", rag_search_enabled=rag_settings.enabled) if tool.name in set(allowed_static)]

            # Dynamic call tools limited by allowed_sub_agent_ids
            dynamic: list[ToolSchemaDef] = []
            allowed_child_ids = set(str(x) for x in (sub_agent.allowed_sub_agent_ids or []))
            if allowed_child_ids:
                defs = (
                    db.query(SubAgentDefinitionModel)
                    .filter(
                        SubAgentDefinitionModel.user_id == user_id,
                        SubAgentDefinitionModel.preset_id == preset_id,
                        SubAgentDefinitionModel.enabled == True,
                    )
                    .all()
                )
                for d in defs:
                    if str(d.id) not in allowed_child_ids:
                        continue
                    dynamic.append(
                        ToolSchemaDef(
                            name=f"call_{d.agent_name}",
                            description=f'Call Sub Agent "{d.display_name}".',
                            parameters={
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {"input": {"type": "string"}},
                                "required": ["input"],
                            },
                        )
                    )

            tools = [*base_tools, *dynamic]
            # SubAgent must always be able to return final result.
            tools.extend(get_tools_for_set("manuscript", rag_search_enabled=rag_settings.enabled, include_return_sub_agent_result=True)[-1:])
            # Avoid duplicates by name
            seen: set[str] = set()
            deduped: list[ToolSchemaDef] = []
            for t in tools:
                if t.name in seen:
                    continue
                seen.add(t.name)
                deduped.append(t)
            tools = deduped

            # Resolve model config (custom override or global subAgent task config)
            if bool(sub_agent.use_custom_llm_config) and isinstance(sub_agent.llm_config_override, dict):
                override = sub_agent.llm_config_override
                provider = str(override.get("provider") or settings_service.get_task_config(db, user_id, "subAgent").provider)
                model = str(override.get("model") or settings_service.get_task_config(db, user_id, "subAgent").model)
                temperature = float(override.get("temperature", settings_service.get_task_config(db, user_id, "subAgent").temperature))
                max_tokens = override.get("max_output_tokens")
                advanced = override.get("advanced") if isinstance(override.get("advanced"), dict) else {}
                thinking_mode = str(advanced.get("thinking_mode") or "off")
                thinking_cfg = advanced.get("thinking_config") if isinstance(advanced.get("thinking_config"), dict) else None
                thinking_format = advanced.get("thinking_format") if isinstance(advanced.get("thinking_format"), str) else None
                request_format = advanced.get("request_format") if isinstance(advanced.get("request_format"), str) else None
            else:
                sub_cfg = settings_service.get_task_config(db, user_id, "subAgent")
                provider = sub_cfg.provider
                model, temperature, max_tokens, thinking_mode, thinking_cfg, thinking_format, request_format = self._task_config_to_fields(sub_cfg)

            return ResolvedRunConfig(
                llm_mode=llm_mode,
                task_type=task_type,
                provider=provider,
                provider_config={},
                model=model,
                temperature=temperature,
                max_output_tokens=max_tokens,
                thinking_mode=thinking_mode,
                thinking_config=thinking_cfg,
                thinking_format=thinking_format,
                request_format=request_format,
                retry_config=retry_config,
                tools=tools,
                allowed_tool_names=[t.name for t in tools],
                memory_enabled=True,
                history_strategy="sub_agent",
                handler_default_options=HandlerDefaultOptions(create_new_version=True, user_request="Sub Agent"),
                preset_id=preset_id,
            )

        # Journey
        if run.run_type != "journey":
            raise ValueError(f"Unknown run type: {run.run_type}")

        if run.journey_kind == "translation":
            task_type = "translation"
            llm_mode = "journey:translation"
            tools = get_tools_for_set("translateObjects", rag_search_enabled=rag_settings.enabled)
            handler_default = HandlerDefaultOptions(create_new_version=False, user_request="AI Translation")
        elif run.journey_kind == "imagePrompt":
            task_type = "imagePrompt"
            llm_mode = "journey:imagePrompt"
            tools = []
            handler_default = HandlerDefaultOptions(create_new_version=False, user_request="Image Prompt")
        else:
            task_type = "editAssistant"
            mode = run.input_payload.get("mode") if isinstance(run.input_payload, dict) else None
            set_name = "manuscript" if mode == "manuscript" else "storyObject"
            llm_mode = f"journey:aiEdit:{set_name}"
            tools = get_tools_for_set(set_name, rag_search_enabled=rag_settings.enabled)
            handler_default = HandlerDefaultOptions(create_new_version=True, user_request="AI Edit")

        task_cfg = settings_service.get_task_config(db, user_id, task_type)
        model, temp, max_tokens, thinking_mode, thinking_cfg, thinking_format, request_format = self._task_config_to_fields(task_cfg)

        return ResolvedRunConfig(
            llm_mode=llm_mode,
            task_type=task_type,
            provider=task_cfg.provider,
            provider_config={},
            model=model,
            temperature=temp,
            max_output_tokens=max_tokens,
            thinking_mode=thinking_mode,
            thinking_config=thinking_cfg,
            thinking_format=thinking_format,
            request_format=request_format,
            retry_config=retry_config,
            tools=tools,
            allowed_tool_names=[t.name for t in tools],
            memory_enabled=False,
            history_strategy="journey",
            handler_default_options=handler_default,
            preset_id=preset_id,
        )


run_type_resolver = RunTypeResolver()
