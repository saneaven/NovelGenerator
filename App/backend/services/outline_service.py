from __future__ import annotations

from typing import Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.db_models import Outline


OUTLINE_KINDS = ("outline", "act", "chapter")
_VALID_PARENT_KIND: dict[str, str | None] = {
    "outline": None,
    "act": "outline",
    "chapter": "act",
}


def require_outline_kind(value: str | None) -> str:
    kind = str(value or "").strip()
    if kind not in OUTLINE_KINDS:
        raise ValueError(f"Unknown outline kind: {value}")
    return kind


def list_outline_siblings(
    db: Session,
    *,
    project_id: UUID,
    parent_id: UUID | None,
    exclude_id: UUID | None = None,
) -> list[Outline]:
    query = (
        db.query(Outline)
        .filter(Outline.project_id == project_id, Outline.parent_id == parent_id)
        .order_by(Outline.position.asc(), Outline.created_at.asc(), Outline.id.asc())
    )
    if exclude_id is not None:
        query = query.filter(Outline.id != exclude_id)
    return query.all()


def collect_affected_outline_rows(
    db: Session,
    *,
    project_id: UUID,
    parent_ids: Iterable[UUID | None],
    include_ids: Iterable[UUID] = (),
) -> list[Outline]:
    rows: list[Outline] = []
    seen_ids: set[UUID] = set()

    for parent_id in parent_ids:
        siblings = list_outline_siblings(db, project_id=project_id, parent_id=parent_id)
        for sibling in siblings:
            if sibling.id in seen_ids:
                continue
            rows.append(sibling)
            seen_ids.add(sibling.id)

    for outline_id in include_ids:
        if outline_id in seen_ids:
            continue
        row = (
            db.query(Outline)
            .filter(Outline.project_id == project_id, Outline.id == outline_id)
            .first()
        )
        if row is None or row.id in seen_ids:
            continue
        rows.append(row)
        seen_ids.add(row.id)

    return rows


def normalize_outline_positions(
    db: Session,
    *,
    project_id: UUID,
    parent_id: UUID | None,
    exclude_id: UUID | None = None,
) -> list[Outline]:
    siblings = list_outline_siblings(db, project_id=project_id, parent_id=parent_id, exclude_id=exclude_id)
    for index, sibling in enumerate(siblings):
        sibling.position = index
    db.flush()
    return siblings


def resolve_outline_parent(
    db: Session,
    *,
    project_id: UUID,
    child_kind: str,
    parent_id: UUID | None,
) -> Outline | None:
    required_parent_kind = _VALID_PARENT_KIND[child_kind]
    if required_parent_kind is None:
        if parent_id is not None:
            raise HTTPException(status_code=400, detail="Root outlines cannot have a parent")
        return None
    if parent_id is None:
        raise HTTPException(status_code=400, detail=f"{child_kind} requires parent_id")
    parent = (
        db.query(Outline)
        .filter(Outline.id == parent_id, Outline.project_id == project_id)
        .first()
    )
    if parent is None:
        raise HTTPException(status_code=404, detail="Parent outline not found")
    if parent.kind != required_parent_kind:
        raise HTTPException(
            status_code=400,
            detail=f"{child_kind} parent must be {required_parent_kind}",
        )
    return parent


def insert_outline_position(
    db: Session,
    *,
    outline: Outline,
    project_id: UUID,
    parent_id: UUID | None,
    requested_position: int | None,
) -> None:
    siblings = normalize_outline_positions(db, project_id=project_id, parent_id=parent_id, exclude_id=outline.id)
    max_position = len(siblings)
    new_position = max_position if requested_position is None else min(max(int(requested_position), 0), max_position)
    for sibling in siblings:
        if sibling.position >= new_position:
            sibling.position += 1
    outline.parent_id = parent_id
    outline.position = new_position
    db.flush()


def move_outline(
    db: Session,
    *,
    outline: Outline,
    project_id: UUID,
    new_parent_id: UUID | None,
    new_position: int | None,
) -> None:
    resolve_outline_parent(
        db,
        project_id=project_id,
        child_kind=outline.kind,
        parent_id=new_parent_id,
    )

    if outline.kind == "outline" and new_parent_id is not None:
        raise HTTPException(status_code=400, detail="Root outlines cannot be moved under another node")

    current_parent_id = outline.parent_id
    if new_parent_id == current_parent_id:
        siblings = normalize_outline_positions(
            db,
            project_id=project_id,
            parent_id=current_parent_id,
            exclude_id=outline.id,
        )
        max_position = len(siblings)
        target_position = outline.position if new_position is None else min(max(int(new_position), 0), max_position)
        for sibling in siblings:
            if sibling.position >= target_position:
                sibling.position += 1
        outline.position = target_position
        db.flush()
        normalize_outline_positions(db, project_id=project_id, parent_id=current_parent_id)
        return

    normalize_outline_positions(db, project_id=project_id, parent_id=current_parent_id, exclude_id=outline.id)
    insert_outline_position(
        db,
        outline=outline,
        project_id=project_id,
        parent_id=new_parent_id,
        requested_position=new_position,
    )
    normalize_outline_positions(db, project_id=project_id, parent_id=current_parent_id)
    normalize_outline_positions(db, project_id=project_id, parent_id=new_parent_id)


def collect_outline_subtree_ids(rows: Iterable[Outline], *, root_id: UUID) -> list[UUID]:
    children_by_parent: dict[UUID | None, list[UUID]] = {}
    for row in rows:
        children_by_parent.setdefault(row.parent_id, []).append(row.id)

    subtree: list[UUID] = [root_id]
    pending = list(children_by_parent.get(root_id, []))
    while pending:
        current = pending.pop(0)
        subtree.append(current)
        pending.extend(children_by_parent.get(current, []))
    return subtree
