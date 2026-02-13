"""Unified run service for root/child runtime states."""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional
import uuid

from sqlalchemy.orm import Session, selectinload

from ..models.db_models import Agent, AgentRunModel, RunMessageModel, RunToolCallModel
from ..schemas.runs import CreateRunRequest, PatchRunRequest, QueryRunsRequest


TERMINAL: set[str] = {"completed", "cancelled"}
ALLOWED_TRANSITIONS: Dict[str, set[str]] = {
    "running": {"waiting", "paused", "error", "completed", "cancelled"},
    "waiting": {"running", "paused", "cancelled", "completed"},
    "paused": {"running", "cancelled"},
    "error": {"running", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


class RunService:
    """Create/query/patch unified run entities."""

    @staticmethod
    def _parse_statuses(values: Optional[Iterable[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        return cleaned if cleaned else None

    @staticmethod
    def _can_transition(current: str, nxt: str) -> bool:
        if current == nxt:
            return True
        if current in TERMINAL:
            return False
        return nxt in ALLOWED_TRANSITIONS.get(current, set())

    def _validate_parent_for_child(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        parent_run_id: uuid.UUID,
        parent_run_message_id: uuid.UUID,
        parent_run_tool_call_id: str,
    ) -> None:
        parent_run = (
            db.query(AgentRunModel)
            .filter(
                AgentRunModel.id == parent_run_id,
                AgentRunModel.project_id == project_id,
                AgentRunModel.agent_id == agent_id,
            )
            .first()
        )
        if not parent_run:
            raise ValueError("Parent run not found")

        parent_message = (
            db.query(RunMessageModel)
            .filter(
                RunMessageModel.id == parent_run_message_id,
                RunMessageModel.run_id == parent_run.id,
            )
            .first()
        )
        if not parent_message:
            raise ValueError("Parent run message not found")
        if parent_message.role != "assistant":
            raise ValueError("Parent run message must be assistant role")

        parent_tc = (
            db.query(RunToolCallModel)
            .filter(
                RunToolCallModel.message_id == parent_message.id,
                RunToolCallModel.llm_call_id == parent_run_tool_call_id,
            )
            .first()
        )
        if not parent_tc:
            raise ValueError("Parent run tool call not found in parent run message")

    def create_run(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: CreateRunRequest,
    ) -> AgentRunModel:
        agent = (
            db.query(Agent)
            .filter(Agent.id == agent_id, Agent.project_id == project_id)
            .with_for_update()
            .first()
        )
        if not agent:
            raise ValueError("Agent not found")

        root_run_seq: Optional[int] = None

        if data.run_kind == "root":
            root_run_seq = int(getattr(agent, "next_root_run_seq", 1) or 1)
            agent.next_root_run_seq = root_run_seq + 1
        else:
            assert data.parent_run_id is not None
            assert data.parent_run_message_id is not None
            assert data.parent_run_tool_call_id is not None
            self._validate_parent_for_child(
                db,
                project_id=project_id,
                agent_id=agent_id,
                parent_run_id=data.parent_run_id,
                parent_run_message_id=data.parent_run_message_id,
                parent_run_tool_call_id=data.parent_run_tool_call_id,
            )

            existing = (
                db.query(AgentRunModel)
                .filter(
                    AgentRunModel.run_kind == "child",
                    AgentRunModel.parent_run_id == data.parent_run_id,
                    AgentRunModel.parent_run_message_id == data.parent_run_message_id,
                    AgentRunModel.parent_run_tool_call_id == data.parent_run_tool_call_id,
                )
                .first()
            )
            if existing:
                return existing

        run = AgentRunModel(
            id=uuid.uuid4(),
            project_id=project_id,
            agent_id=agent_id,
            run_kind=data.run_kind,
            caller=data.caller,
            status=data.status,
            language=data.language,
            input_text=data.input_text,
            run_mode=data.run_mode,
            surface=data.surface,
            context_object_ids=list(data.context_object_ids or []),
            parent_run_id=data.parent_run_id,
            parent_run_message_id=data.parent_run_message_id,
            parent_run_tool_call_id=data.parent_run_tool_call_id,
            sub_agent_id=data.sub_agent_id,
            root_run_seq=root_run_seq,
            next_message_seq=1,
        )
        db.add(run)
        db.commit()

        return self.get_run(
            db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run.id,
            include_messages=True,
            include_tool_calls=True,
        )

    def patch_run(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        data: PatchRunRequest,
    ) -> AgentRunModel:
        run = (
            db.query(AgentRunModel)
            .filter(
                AgentRunModel.id == run_id,
                AgentRunModel.project_id == project_id,
                AgentRunModel.agent_id == agent_id,
            )
            .first()
        )
        if not run:
            raise ValueError("Run not found")

        if data.status is not None:
            if not self._can_transition(run.status, data.status):
                raise ValueError(f"Invalid run status transition: {run.status} -> {data.status}")
            run.status = data.status
        if data.final_output is not None:
            run.final_output = data.final_output
        if data.error is not None:
            run.error = data.error

        db.commit()
        return self.get_run(
            db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run.id,
            include_messages=True,
            include_tool_calls=True,
        )

    def get_run(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        include_messages: bool,
        include_tool_calls: bool,
    ) -> AgentRunModel:
        query = db.query(AgentRunModel).filter(
            AgentRunModel.id == run_id,
            AgentRunModel.project_id == project_id,
            AgentRunModel.agent_id == agent_id,
        )
        if include_messages:
            if include_tool_calls:
                query = query.options(
                    selectinload(AgentRunModel.messages).selectinload(RunMessageModel.tool_calls)
                )
            else:
                query = query.options(selectinload(AgentRunModel.messages))
        run = query.first()
        if not run:
            raise ValueError("Run not found")
        return run

    def query_runs(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: QueryRunsRequest,
    ) -> List[AgentRunModel]:
        statuses = self._parse_statuses(data.statuses)

        query = db.query(AgentRunModel).filter(
            AgentRunModel.project_id == project_id,
            AgentRunModel.agent_id == agent_id,
        )

        if data.root_only:
            query = query.filter(AgentRunModel.run_kind == "root")
        if statuses:
            query = query.filter(AgentRunModel.status.in_(statuses))
        if data.parent_run_message_ids:
            query = query.filter(AgentRunModel.parent_run_message_id.in_(data.parent_run_message_ids))

        if data.include_messages:
            if data.include_tool_calls:
                query = query.options(
                    selectinload(AgentRunModel.messages).selectinload(RunMessageModel.tool_calls)
                )
            else:
                query = query.options(selectinload(AgentRunModel.messages))

        return query.order_by(
            AgentRunModel.root_run_seq.asc().nullslast(),
            AgentRunModel.created_at.asc(),
            AgentRunModel.id.asc(),
        ).all()

    def delete_tree_for_agent_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        message_id: uuid.UUID,
    ) -> int:
        """Delete child run trees rooted at an agent assistant message."""
        root_rows = (
            db.query(AgentRunModel.id)
            .filter(
                AgentRunModel.project_id == project_id,
                AgentRunModel.agent_id == agent_id,
                AgentRunModel.parent_run_message_id == message_id,
            )
            .all()
        )
        root_ids = [row.id for row in root_rows]
        if not root_ids:
            return 0

        to_delete: set[uuid.UUID] = set(root_ids)
        frontier: List[uuid.UUID] = list(root_ids)

        while frontier:
            child_rows = (
                db.query(AgentRunModel.id)
                .filter(
                    AgentRunModel.project_id == project_id,
                    AgentRunModel.agent_id == agent_id,
                    AgentRunModel.parent_run_id.in_(frontier),
                )
                .all()
            )
            next_frontier: List[uuid.UUID] = []
            for row in child_rows:
                if row.id in to_delete:
                    continue
                to_delete.add(row.id)
                next_frontier.append(row.id)
            frontier = next_frontier

        db.query(AgentRunModel).filter(AgentRunModel.id.in_(list(to_delete))).delete(synchronize_session=False)
        return len(to_delete)


run_service = RunService()
