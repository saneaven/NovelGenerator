from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import SubAgentDefinitionModel


ToolSetName = Literal[
    "agent_plan_mode",
    "agent_agent_mode",
    "manuscript",
    "storyObject",
    "outline",
    "translateObjects",
]

AutoApproveCategory = Literal["read", "search", "create", "delete", "replace", "patch", "subAgent"]


@dataclass(frozen=True)
class ToolSchemaDef:
    name: str
    description: str
    parameters: dict[str, Any]


# Shared property snippets
_ID = {"type": "string", "description": "Object ID"}
_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_STORY_TYPE = {
    "type": "string",
    "enum": ["character", "location", "organization", "lorebook"],
    "description": "Story object type",
}


def _obj_schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
    }


# CRUD 8
CREATE_STORY_OBJECT = ToolSchemaDef(
    "create_story_object",
    "Create a story object.",
    _obj_schema({"type": _STORY_TYPE, "name": _NAME, "description": _DESC, "content": _CONTENT}, ["type", "name", "content"]),
)
DELETE_STORY_OBJECT = ToolSchemaDef(
    "delete_story_object",
    "Delete a story object.",
    _obj_schema({"id": _ID, "type": _STORY_TYPE}, ["id", "type"]),
)
CREATE_OUTLINE = ToolSchemaDef(
    "create_outline",
    "Create an outline.",
    _obj_schema({"name": _NAME, "description": _DESC, "content": _CONTENT}, ["name", "content"]),
)
DELETE_OUTLINE = ToolSchemaDef(
    "delete_outline",
    "Delete an outline.",
    _obj_schema({"id": _ID}, ["id"]),
)
CREATE_OUTLINE_ACT = ToolSchemaDef(
    "create_outline_act",
    "Create an act in outline.",
    _obj_schema({"outlineId": {"type": "string"}, "name": _NAME, "description": _DESC, "content": _CONTENT}, ["outlineId", "name", "content"]),
)
DELETE_OUTLINE_ACT = ToolSchemaDef(
    "delete_outline_act",
    "Delete an act.",
    _obj_schema({"id": _ID}, ["id"]),
)
CREATE_OUTLINE_CHAPTER = ToolSchemaDef(
    "create_outline_chapter",
    "Create a chapter in act.",
    _obj_schema({"actId": {"type": "string"}, "name": _NAME, "description": _DESC, "content": _CONTENT}, ["actId", "name", "content"]),
)
DELETE_OUTLINE_CHAPTER = ToolSchemaDef(
    "delete_outline_chapter",
    "Delete a chapter.",
    _obj_schema({"id": _ID}, ["id"]),
)

# Replace 7
REPLACE_BASIC_INFO = ToolSchemaDef(
    "replace_basic_info",
    "Replace project basic info.",
    _obj_schema({"title": {"type": "string"}, "logline": {"type": "string"}, "genre": {"type": "string"}}, []),
)
REPLACE_GUIDELINES = ToolSchemaDef(
    "replace_guidelines",
    "Replace guidelines.",
    _obj_schema({"id": _ID, "authorNote": {"type": "string"}}, ["id", "authorNote"]),
)
REPLACE_STORY_OBJECT = ToolSchemaDef(
    "replace_story_object",
    "Replace story object fields.",
    _obj_schema(
        {"id": _ID, "type": _STORY_TYPE, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}},
        ["id", "type"],
    ),
)
REPLACE_MANUSCRIPT = ToolSchemaDef(
    "replace_manuscript",
    "Replace full manuscript content.",
    _obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
)
REPLACE_OUTLINE = ToolSchemaDef(
    "replace_outline",
    "Replace outline fields.",
    _obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
)
REPLACE_OUTLINE_ACT = ToolSchemaDef(
    "replace_outline_act",
    "Replace act fields.",
    _obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}, "order": {"type": "integer"}}, ["id"]),
)
REPLACE_OUTLINE_CHAPTER = ToolSchemaDef(
    "replace_outline_chapter",
    "Replace chapter fields.",
    _obj_schema(
        {
            "id": _ID,
            "actId": {"type": "string"},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "content": {"type": "string"},
            "order": {"type": "integer"},
        },
        ["id"],
    ),
)

# Patch 7
PATCH_BASIC_INFO = ToolSchemaDef(
    "patch_basic_info",
    "Patch basic info by single replacement.",
    _obj_schema(
        {
            "field": {"type": "string", "enum": ["title", "logline", "genre"]},
            "old": {"type": "string"},
            "new": {"type": "string"},
        },
        ["field", "old", "new"],
    ),
)
PATCH_GUIDELINES = ToolSchemaDef(
    "patch_guidelines",
    "Patch guidelines by single replacement.",
    _obj_schema(
        {
            "id": _ID,
            "field": {"type": "string", "enum": ["authorNote"]},
            "old": {"type": "string"},
            "new": {"type": "string"},
        },
        ["id", "field", "old", "new"],
    ),
)
PATCH_STORY_OBJECT = ToolSchemaDef(
    "patch_story_object",
    "Patch story object by single replacement.",
    _obj_schema(
        {
            "id": _ID,
            "type": _STORY_TYPE,
            "field": {"type": "string", "enum": ["name", "description", "content"]},
            "old": {"type": "string"},
            "new": {"type": "string"},
        },
        ["id", "type", "field", "old", "new"],
    ),
)
PATCH_MANUSCRIPT = ToolSchemaDef(
    "patch_manuscript",
    "Patch manuscript by single replacement.",
    _obj_schema({"id": _ID, "old": {"type": "string"}, "new": {"type": "string"}}, ["id", "old", "new"]),
)
PATCH_OUTLINE = ToolSchemaDef(
    "patch_outline",
    "Patch outline by single replacement.",
    _obj_schema(
        {
            "id": _ID,
            "field": {"type": "string", "enum": ["name", "description", "content"]},
            "old": {"type": "string"},
            "new": {"type": "string"},
        },
        ["id", "field", "old", "new"],
    ),
)
PATCH_OUTLINE_ACT = ToolSchemaDef(
    "patch_outline_act",
    "Patch act by single replacement.",
    _obj_schema(
        {
            "id": _ID,
            "field": {"type": "string", "enum": ["name", "description", "content"]},
            "old": {"type": "string"},
            "new": {"type": "string"},
            "order": {"type": "integer"},
        },
        ["id", "field", "old", "new"],
    ),
)
PATCH_OUTLINE_CHAPTER = ToolSchemaDef(
    "patch_outline_chapter",
    "Patch chapter by single replacement.",
    _obj_schema(
        {
            "id": _ID,
            "field": {"type": "string", "enum": ["name", "description", "content"]},
            "old": {"type": "string"},
            "new": {"type": "string"},
            "actId": {"type": "string"},
            "order": {"type": "integer"},
        },
        ["id", "field", "old", "new"],
    ),
)

# Read/search 5 + 1 sub-agent
READ_STORY_OBJECT = ToolSchemaDef(
    "read_story_object",
    "Read a story object.",
    _obj_schema({"id": _ID, "type": {"type": "string", "enum": ["character", "location", "organization", "lorebook", "guidelines"]}}, ["id", "type"]),
)
READ_OUTLINE = ToolSchemaDef(
    "read_outline",
    "Read an outline object.",
    _obj_schema({"id": _ID, "type": {"type": "string", "enum": ["outline", "act", "chapter"]}}, ["id", "type"]),
)
READ_MANUSCRIPT = ToolSchemaDef(
    "read_manuscript",
    "Read manuscript text.",
    _obj_schema(
        {
            "id": _ID,
            "offset": {
                "type": "object",
                "properties": {"from": {"type": "integer"}, "to": {"type": "integer"}},
                "required": ["from", "to"],
            },
        },
        ["id"],
    ),
)
RAG_SEARCH = ToolSchemaDef(
    "rag_search",
    "Search by embeddings in project knowledge base.",
    _obj_schema({"queries": {"type": "array", "items": {"type": "string"}}}, ["queries"]),
)
KEYWORD_SEARCH = ToolSchemaDef(
    "keyword_search",
    "Search by keyword in project knowledge base.",
    _obj_schema({"keyword": {"type": "string"}, "page": {"type": "integer"}}, ["keyword"]),
)
ALL_TOOL_SCHEMAS: dict[str, ToolSchemaDef] = {
    s.name: s
    for s in [
        CREATE_STORY_OBJECT,
        DELETE_STORY_OBJECT,
        CREATE_OUTLINE,
        DELETE_OUTLINE,
        CREATE_OUTLINE_ACT,
        DELETE_OUTLINE_ACT,
        CREATE_OUTLINE_CHAPTER,
        DELETE_OUTLINE_CHAPTER,
        REPLACE_BASIC_INFO,
        REPLACE_GUIDELINES,
        REPLACE_STORY_OBJECT,
        REPLACE_MANUSCRIPT,
        REPLACE_OUTLINE,
        REPLACE_OUTLINE_ACT,
        REPLACE_OUTLINE_CHAPTER,
        PATCH_BASIC_INFO,
        PATCH_GUIDELINES,
        PATCH_STORY_OBJECT,
        PATCH_MANUSCRIPT,
        PATCH_OUTLINE,
        PATCH_OUTLINE_ACT,
        PATCH_OUTLINE_CHAPTER,
        READ_STORY_OBJECT,
        READ_OUTLINE,
        READ_MANUSCRIPT,
        RAG_SEARCH,
        KEYWORD_SEARCH,
    ]
}


TOOL_SET_SCHEMAS: dict[ToolSetName, list[str]] = {
    "agent_plan_mode": [
        "read_story_object",
        "read_outline",
        "read_manuscript",
        "keyword_search",
        "rag_search",
    ],
    "agent_agent_mode": list(ALL_TOOL_SCHEMAS.keys()),
    "manuscript": ["replace_manuscript", "patch_manuscript"],
    "storyObject": [
        "create_story_object",
        "delete_story_object",
        "replace_basic_info",
        "replace_guidelines",
        "replace_story_object",
        "patch_basic_info",
        "patch_guidelines",
        "patch_story_object",
    ],
    "outline": [
        "create_outline",
        "delete_outline",
        "create_outline_act",
        "delete_outline_act",
        "create_outline_chapter",
        "delete_outline_chapter",
        "replace_outline",
        "replace_outline_act",
        "replace_outline_chapter",
        "patch_outline",
        "patch_outline_act",
        "patch_outline_chapter",
    ],
    "translateObjects": [
        "replace_basic_info",
        "replace_guidelines",
        "replace_story_object",
        "replace_manuscript",
        "replace_outline",
        "replace_outline_act",
        "replace_outline_chapter",
        "patch_basic_info",
        "patch_guidelines",
        "patch_story_object",
        "patch_manuscript",
        "patch_outline",
        "patch_outline_act",
        "patch_outline_chapter",
    ],
}


def build_call_tool_schema(agent_name: str, display_name: str, description: str | None = None) -> ToolSchemaDef:
    desc = (description or "").strip()
    call_desc = f'Call Sub Agent "{display_name}".'
    if desc:
        call_desc = f'{call_desc} {desc}'
    return ToolSchemaDef(
        name=f"call_{agent_name}",
        description=call_desc,
        parameters=_obj_schema(
            {
                "input": {
                    "type": "string",
                    "description": "Input for the sub-agent. Include complete context and instructions.",
                }
            },
            ["input"],
        ),
    )


def get_dynamic_call_tools(db: Session, *, user_id: UUID, preset_id: UUID) -> list[ToolSchemaDef]:
    defs = (
        db.query(SubAgentDefinitionModel)
        .filter(
            SubAgentDefinitionModel.user_id == user_id,
            SubAgentDefinitionModel.preset_id == preset_id,
            SubAgentDefinitionModel.enabled == True,
        )
        .order_by(SubAgentDefinitionModel.agent_name.asc())
        .all()
    )
    out: list[ToolSchemaDef] = []
    for d in defs:
        display = (d.display_name or d.agent_name or "").strip() or d.agent_name
        out.append(build_call_tool_schema(d.agent_name, display, d.description))
    return out


def get_tools_for_set(
    set_name: ToolSetName,
    *,
    rag_search_enabled: bool = True,
    dynamic_call_tools: list[ToolSchemaDef] | None = None,
) -> list[ToolSchemaDef]:
    names = TOOL_SET_SCHEMAS[set_name]
    out: list[ToolSchemaDef] = []
    for name in names:
        if name == "rag_search" and not rag_search_enabled:
            continue
        schema = ALL_TOOL_SCHEMAS.get(name)
        if schema is not None:
            out.append(schema)

    if dynamic_call_tools:
        out.extend(dynamic_call_tools)

    return out


def get_tool_schema(name: str) -> ToolSchemaDef | None:
    if name.startswith("call_"):
        # Dynamic call tools are validated by regex + runtime checks; schema is built per run.
        return None
    return ALL_TOOL_SCHEMAS.get(name)


def get_auto_approve_category(tool_name: str) -> AutoApproveCategory | None:
    if tool_name == "rag_search" or tool_name == "keyword_search":
        return "search"
    if tool_name.startswith("call_"):
        return "subAgent"
    if tool_name.startswith("read_"):
        return "read"
    if tool_name.startswith("create_"):
        return "create"
    if tool_name.startswith("delete_"):
        return "delete"
    if tool_name.startswith("replace_"):
        return "replace"
    if tool_name.startswith("patch_"):
        return "patch"
    return None
