from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class CalendarUnitSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    label: str
    count: int | None = None


class CalendarConfigSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["fixed", "gregorian"] | None = None
    units: list[CalendarUnitSchema]


class TimelineTrackCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str
    name: str
    description: str
    content: str | dict
    rich_text_format: str = "tiptap"
    parent_id: str | None = None
    position: int | None = None
    color: str | None = None
    user_request: str = "Timeline Track Creation"


class TimelineTrackUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str | None = None
    name: str | None = None
    description: str | None = None
    content: Any = None
    rich_text_format: str = "tiptap"
    color: str | None = None
    user_request: str = "Timeline Track Update"
    create_new_version: bool = True


class TimelineTrackMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parent_id: str | None = None
    position: int | None = None


class TimelineEventLinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_type: str
    object_id: str


class TimelineEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    track_id: str
    language: str
    name: str
    description: str
    content: str | dict
    rich_text_format: str = "tiptap"
    start_date: dict[str, int]
    end_date: dict[str, int] | None = None
    tags: list[str] = Field(default_factory=list)
    links: list[TimelineEventLinkCreate] = Field(default_factory=list)
    user_request: str = "Timeline Event Creation"


class TimelineEventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    track_id: str | None = None
    language: str | None = None
    name: str | None = None
    description: str | None = None
    content: Any = None
    rich_text_format: str = "tiptap"
    start_date: dict[str, int] | None = None
    end_date: dict[str, int] | None = None
    tags: list[str] | None = None
    user_request: str = "Timeline Event Update"
    create_new_version: bool = True


class TimelineEventLinkRequest(TimelineEventLinkCreate):
    pass


class TimelineEventLinkResponse(BaseModel):
    id: str
    event_id: str
    object_type: str
    object_id: str
    created_at: str | None = None


class TimelineTrackResponse(BaseModel):
    id: str
    timeline_id: str
    parent_id: str | None = None
    position: int
    color: str
    created_at: str | None = None
    updated_at: str | None = None
    data: dict[str, Any]
    version: dict[str, Any]
    events: list["TimelineEventResponse"] = Field(default_factory=list)
    children: list["TimelineTrackResponse"] = Field(default_factory=list)


class TimelineEventResponse(BaseModel):
    id: str
    track_id: str
    start_date: dict[str, int]
    end_date: dict[str, int] | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None
    data: dict[str, Any]
    version: dict[str, Any]
    links: list[TimelineEventLinkResponse] = Field(default_factory=list)


class FullTimelineResponse(BaseModel):
    id: str
    project_id: str
    calendar: dict[str, Any]
    tracks: list[TimelineTrackResponse]
    warnings: list[str] = Field(default_factory=list)


class CalendarUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    calendar: CalendarConfigSchema


TimelineTrackResponse.model_rebuild()
