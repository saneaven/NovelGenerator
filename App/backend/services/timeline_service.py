"""Timeline service for unified root/child run history."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple
import uuid

from sqlalchemy.orm import Session, selectinload

from ..models.db_models import AgentRunModel, RunMessageModel, RunToolCallModel


class TimelineService:
    def _parse_cursor(self, cursor: Optional[str]) -> Optional[int]:
        if cursor is None:
            return None
        raw = str(cursor).strip()
        if not raw:
            return None
        try:
            value = int(raw)
            if value <= 0:
                return None
            return value
        except Exception:
            return None

    def get_timeline(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        include_children: bool,
        limit: int,
        cursor: Optional[str],
    ) -> Tuple[List[AgentRunModel], Optional[str]]:
        safe_limit = max(1, min(int(limit or 50), 200))
        cursor_seq = self._parse_cursor(cursor)

        query = (
            db.query(AgentRunModel)
            .filter(
                AgentRunModel.project_id == project_id,
                AgentRunModel.agent_id == agent_id,
                AgentRunModel.run_kind == "root",
            )
            .options(selectinload(AgentRunModel.messages).selectinload(RunMessageModel.tool_calls))
        )
        if cursor_seq is not None:
            query = query.filter(AgentRunModel.root_run_seq < cursor_seq)

        roots = (
            query.order_by(AgentRunModel.root_run_seq.desc().nullslast(), AgentRunModel.created_at.desc())
            .limit(safe_limit + 1)
            .all()
        )

        has_more = len(roots) > safe_limit
        roots = roots[:safe_limit]

        if include_children and roots:
            root_ids = [row.id for row in roots]
            children = (
                db.query(AgentRunModel)
                .filter(
                    AgentRunModel.run_kind == "child",
                    AgentRunModel.parent_run_id.in_(root_ids),
                )
                .order_by(AgentRunModel.created_at.asc(), AgentRunModel.id.asc())
                .all()
            )
            child_map: Dict[uuid.UUID, List[AgentRunModel]] = {}
            for child in children:
                if not child.parent_run_id:
                    continue
                child_map.setdefault(child.parent_run_id, []).append(child)
            for root in roots:
                setattr(root, "_timeline_children", child_map.get(root.id, []))
        else:
            for root in roots:
                setattr(root, "_timeline_children", [])

        next_cursor = None
        if has_more and roots:
            last = roots[-1]
            if last.root_run_seq is not None:
                next_cursor = str(last.root_run_seq)

        return roots, next_cursor


timeline_service = TimelineService()

