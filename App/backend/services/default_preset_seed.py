from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
import uuid

from pydantic import ValidationError

from ..schemas.mcp import McpServerResponse
from ..schemas.presets import ExportVariableData, PresetExportData
from ..schemas.sub_agents import SubAgentDefinition
from .prompt_runtime.scenario_validation import normalize_and_validate_scenario


DEFAULT_PRESET_PATH = Path(__file__).resolve().parents[1] / "prompts" / "Default.nbprompt"


@dataclass(frozen=True)
class NormalizedScenarioSeed:
    task_type: str
    task_subtype: str
    scenario: dict[str, Any]


@dataclass(frozen=True)
class NormalizedFragmentSeed:
    folder_key: str
    fragment_name: str
    content: str
    description: Optional[str]


@dataclass(frozen=True)
class NormalizedPresetSeed:
    preset_name: str
    preset_description: Optional[str]
    scenarios: tuple[NormalizedScenarioSeed, ...]
    fragments: tuple[NormalizedFragmentSeed, ...]
    variables: tuple[ExportVariableData, ...]
    sub_agents: tuple[SubAgentDefinition, ...]
    mcp_servers: tuple[McpServerResponse, ...]


def normalize_preset_seed(data: PresetExportData) -> NormalizedPresetSeed:
    prompts_data = data.prompts
    if not isinstance(prompts_data, dict):
        raise ValueError("Invalid preset file: prompts must be an object")

    scenarios: list[NormalizedScenarioSeed] = []
    for task_type, subtypes in prompts_data.items():
        if not isinstance(subtypes, dict):
            raise ValueError("Invalid preset file: prompts subtypes must be an object")

        for task_subtype, scenario_doc in subtypes.items():
            normalized, _warnings = normalize_and_validate_scenario(scenario_doc)
            scenarios.append(
                NormalizedScenarioSeed(
                    task_type=str(task_type),
                    task_subtype=str(task_subtype),
                    scenario=normalized,
                )
            )

    fragments: list[NormalizedFragmentSeed] = []
    for folder_key, fragment_map in data.fragments.items():
        if not isinstance(fragment_map, dict):
            raise ValueError("Invalid preset file: fragments folders must be objects")

        normalized_folder_key = "_root" if str(folder_key) == "_root" else str(folder_key).strip("/")
        if not normalized_folder_key:
            raise ValueError("Invalid preset file: fragment folder key cannot be empty")

        for fragment_name, fragment_data in fragment_map.items():
            fragments.append(
                NormalizedFragmentSeed(
                    folder_key=normalized_folder_key,
                    fragment_name=str(fragment_name),
                    content=fragment_data.content,
                    description=fragment_data.description,
                )
            )

    source_sub_agents = tuple(data.sub_agents)
    sub_agent_scenarios = {item.task_subtype for item in scenarios if item.task_type == "subAgent"}
    sub_agent_names = {item.agent_name for item in source_sub_agents}
    if sub_agent_scenarios != sub_agent_names:
        missing_scenarios = sorted(sub_agent_names - sub_agent_scenarios)
        orphan_scenarios = sorted(sub_agent_scenarios - sub_agent_names)
        details: list[str] = []
        if missing_scenarios:
            details.append(f"missing subAgent prompt scenarios: {', '.join(missing_scenarios)}")
        if orphan_scenarios:
            details.append(f"orphan subAgent prompt scenarios: {', '.join(orphan_scenarios)}")
        raise ValueError(f"Invalid preset file: {'; '.join(details)}")

    sub_agent_id_set = {item.id for item in source_sub_agents}
    for item in source_sub_agents:
        missing_refs = [str(ref) for ref in item.allowed_sub_agent_ids if ref not in sub_agent_id_set]
        if missing_refs:
            raise ValueError(
                f"Invalid preset file: sub_agent '{item.agent_name}' references unknown sub-agent IDs: "
                f"{', '.join(missing_refs)}"
            )

    return NormalizedPresetSeed(
        preset_name=str(data.preset.get("name") or "Default").strip() or "Default",
        preset_description=data.preset.get("description"),
        scenarios=tuple(scenarios),
        fragments=tuple(fragments),
        variables=tuple(data.variables),
        sub_agents=source_sub_agents,
        mcp_servers=tuple(data.mcp_servers),
    )


@lru_cache(maxsize=1)
def load_default_preset_seed() -> NormalizedPresetSeed:
    try:
        payload = PresetExportData.model_validate_json(DEFAULT_PRESET_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"Default preset file not found: {DEFAULT_PRESET_PATH}") from exc
    except ValidationError as exc:
        raise RuntimeError(f"Default preset file is invalid: {DEFAULT_PRESET_PATH}") from exc

    try:
        return normalize_preset_seed(payload)
    except ValueError as exc:
        raise RuntimeError(f"Default preset seed is invalid: {exc}") from exc


def clear_default_preset_seed_cache() -> None:
    load_default_preset_seed.cache_clear()


def validate_default_preset_seed() -> None:
    load_default_preset_seed()
