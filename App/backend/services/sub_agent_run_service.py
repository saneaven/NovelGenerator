"""Service for persistent Sub Agent run states — incremental persistence."""

from __future__ import annotations

from datetime import datetime
import uuid
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session

from ..models.db_models import (
    AgentMessage,
    SubAgentRunMessageModel,
    SubAgentRunModel,
)
from ..schemas.sub_agent_runs import (
    AddMessageRequest,
    CreateRunRequest,
    PatchRunRequest,
    SubAgentRunQueryByMessagesRequest,
    UpdateMessageRequest,
)


class SubAgentRunService:
    """Persistence and query logic for Sub Agent runs."""

    # ------------------------------------------------------------------
    # Parent validation (kept from original)
    # ------------------------------------------------------------------

    @staticmethod
    def _has_tool_call(tool_calls: object, tool_call_id: str) -> bool:
        if not isinstance(tool_calls, list):
            return False
        for item in tool_calls:
            if not isinstance(item, dict):
                continue
            if str(item.get("id", "")) == tool_call_id:
                return True
        return False

    def _validate_parent(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        parent_type: str,
        parent_id: uuid.UUID,
        parent_message_id: uuid.UUID,
        parent_tool_call_id: str,
    ) -> None:
        if parent_type == "agent":
            if parent_id != agent_id:
                raise ValueError("Invalid parent: for parent_type=agent, parent_id must equal agent_id")

            parent_message = (
                db.query(AgentMessage)
                .filter(
                    AgentMessage.id == parent_message_id,
                    AgentMessage.agent_id == agent_id,
                )
                .first()
            )
            if not parent_message:
                raise ValueError("Invalid parent: parent agent message not found")
            if parent_message.role != "assistant":
                raise ValueError("Invalid parent: parent agent message must be assistant role")
            if not self._has_tool_call(parent_message.tool_calls, parent_tool_call_id):
                raise ValueError("Invalid parent: parent_tool_call_id not found in parent agent message")
            return

        if parent_type == "sub_agent":
            parent_run = (
                db.query(SubAgentRunModel)
                .filter(
                    SubAgentRunModel.id == parent_id,
                    SubAgentRunModel.project_id == project_id,
                    SubAgentRunModel.agent_id == agent_id,
                )
                .first()
            )
            if not parent_run:
                raise ValueError("Invalid parent: parent Sub Agent run not found")

            parent_message = (
                db.query(SubAgentRunMessageModel)
                .filter(
                    SubAgentRunMessageModel.id == parent_message_id,
                    SubAgentRunMessageModel.run_id == parent_run.id,
                )
                .first()
            )
            if not parent_message:
                raise ValueError("Invalid parent: parent Sub Agent message not found")
            if parent_message.role != "assistant":
                raise ValueError("Invalid parent: parent Sub Agent message must be assistant role")
            if not self._has_tool_call(parent_message.tool_calls, parent_tool_call_id):
                raise ValueError("Invalid parent: parent_tool_call_id not found in parent Sub Agent message")
            return

        raise ValueError("Invalid parent_type. Allowed values: agent, sub_agent")

    # ------------------------------------------------------------------
    # Create Run
    # ------------------------------------------------------------------

    def create_run(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: CreateRunRequest,
    ) -> SubAgentRunModel:
        self._validate_parent(
            db,
            project_id=project_id,
            agent_id=agent_id,
            parent_type=data.parent_type,
            parent_id=data.parent_id,
            parent_message_id=data.parent_message_id,
            parent_tool_call_id=data.parent_tool_call_id,
        )

        run = SubAgentRunModel(
            id=uuid.uuid4(),
            project_id=project_id,
            agent_id=agent_id,
            parent_type=data.parent_type,
            parent_id=data.parent_id,
            parent_message_id=data.parent_message_id,
            parent_tool_call_id=data.parent_tool_call_id,
            sub_agent_id=data.sub_agent_id,
            agent_name=data.agent_name,
            display_name=data.display_name,
            caller=data.caller,
            language=data.language,
            input=data.input,
            status=data.status,
            next_message_seq=1,
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        # Eagerly load empty messages list
        run.messages = []
        return run

    # ------------------------------------------------------------------
    # Patch Run (status / final_output / error)
    # ------------------------------------------------------------------

    def patch_run(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        data: PatchRunRequest,
    ) -> SubAgentRunModel:
        run = (
            db.query(SubAgentRunModel)
            .filter(
                SubAgentRunModel.id == run_id,
                SubAgentRunModel.project_id == project_id,
                SubAgentRunModel.agent_id == agent_id,
            )
            .first()
        )
        if not run:
            raise ValueError("Sub Agent run not found")

        if data.status is not None:
            run.status = data.status
        if data.final_output is not None:
            run.final_output = data.final_output
        if data.error is not None:
            run.error = data.error

        db.commit()
        db.refresh(run)
        return run

    # ------------------------------------------------------------------
    # Add Message (incremental, with seq allocation)
    # ------------------------------------------------------------------

    def add_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        data: AddMessageRequest,
    ) -> SubAgentRunMessageModel:
        run = (
            db.query(SubAgentRunModel)
            .filter(
                SubAgentRunModel.id == run_id,
                SubAgentRunModel.project_id == project_id,
                SubAgentRunModel.agent_id == agent_id,
            )
            .with_for_update()
            .first()
        )
        if not run:
            raise ValueError("Sub Agent run not found")

        seq = run.next_message_seq
        run.next_message_seq = seq + 1

        message = SubAgentRunMessageModel(
            id=uuid.uuid4(),
            run_id=run.id,
            seq=seq,
            role=data.role,
            content_parts=data.content_parts or [],
            tool_calls=data.tool_calls,
            thinking_details=data.thinking_details,
            created_at=datetime.utcnow(),
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    # ------------------------------------------------------------------
    # Update Message (tool_calls / thinking_details)
    # ------------------------------------------------------------------

    def update_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        message_id: uuid.UUID,
        data: UpdateMessageRequest,
    ) -> SubAgentRunMessageModel:
        # Verify ownership
        run = (
            db.query(SubAgentRunModel)
            .filter(
                SubAgentRunModel.id == run_id,
                SubAgentRunModel.project_id == project_id,
                SubAgentRunModel.agent_id == agent_id,
            )
            .first()
        )
        if not run:
            raise ValueError("Sub Agent run not found")

        message = (
            db.query(SubAgentRunMessageModel)
            .filter(
                SubAgentRunMessageModel.id == message_id,
                SubAgentRunMessageModel.run_id == run.id,
            )
            .first()
        )
        if not message:
            raise ValueError("Sub Agent run message not found")

        from sqlalchemy.orm.attributes import flag_modified

        if data.tool_calls is not None:
            message.tool_calls = data.tool_calls
            flag_modified(message, "tool_calls")
        if data.thinking_details is not None:
            message.thinking_details = data.thinking_details
            flag_modified(message, "thinking_details")

        db.commit()
        db.refresh(message)
        return message

    # ------------------------------------------------------------------
    # Query (kept from original, adapted to new names)
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_status_filter(values: Optional[Iterable[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        return cleaned if cleaned else None

    def query_by_root_agent_messages(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: SubAgentRunQueryByMessagesRequest,
    ) -> List[SubAgentRunModel]:
        if not data.message_ids:
            return []

        status_filter = self._parse_status_filter(data.status_filter)

        root_query = db.query(SubAgentRunModel).filter(
            SubAgentRunModel.project_id == project_id,
            SubAgentRunModel.agent_id == agent_id,
            SubAgentRunModel.parent_type == "agent",
            SubAgentRunModel.parent_id == agent_id,
            SubAgentRunModel.parent_message_id.in_(data.message_ids),
        )
        if status_filter:
            root_query = root_query.filter(SubAgentRunModel.status.in_(status_filter))

        roots = root_query.order_by(SubAgentRunModel.created_at, SubAgentRunModel.id).all()
        if not roots:
            return []

        ordered_ids: List[uuid.UUID] = []
        visited: Set[uuid.UUID] = set()
        all_by_id: Dict[uuid.UUID, SubAgentRunModel] = {}

        def add_items(items: List[SubAgentRunModel]) -> List[uuid.UUID]:
            frontier: List[uuid.UUID] = []
            for item in items:
                if item.id in visited:
                    continue
                visited.add(item.id)
                all_by_id[item.id] = item
                ordered_ids.append(item.id)
                frontier.append(item.id)
            return frontier

        frontier = add_items(roots)
        while frontier:
            child_query = db.query(SubAgentRunModel).filter(
                SubAgentRunModel.project_id == project_id,
                SubAgentRunModel.agent_id == agent_id,
                SubAgentRunModel.parent_type == "sub_agent",
                SubAgentRunModel.parent_id.in_(frontier),
            )
            if status_filter:
                child_query = child_query.filter(SubAgentRunModel.status.in_(status_filter))

            children = child_query.order_by(SubAgentRunModel.created_at, SubAgentRunModel.id).all()
            frontier = add_items(children)

        if not ordered_ids:
            return []

        grouped_messages: Dict[uuid.UUID, List[SubAgentRunMessageModel]] = {}
        for msg in (
            db.query(SubAgentRunMessageModel)
            .filter(SubAgentRunMessageModel.run_id.in_(ordered_ids))
            .order_by(SubAgentRunMessageModel.run_id, SubAgentRunMessageModel.seq)
            .all()
        ):
            grouped_messages.setdefault(msg.run_id, []).append(msg)

        result: List[SubAgentRunModel] = []
        for run_id in ordered_ids:
            run = all_by_id[run_id]
            run.messages = grouped_messages.get(run_id, [])
            result.append(run)
        return result

    # ------------------------------------------------------------------
    # Delete tree (kept from original, adapted to new names)
    # ------------------------------------------------------------------

    def delete_tree_for_agent_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        message_id: uuid.UUID,
    ) -> int:
        root_ids = [
            row[0]
            for row in (
                db.query(SubAgentRunModel.id)
                .filter(
                    SubAgentRunModel.project_id == project_id,
                    SubAgentRunModel.agent_id == agent_id,
                    SubAgentRunModel.parent_type == "agent",
                    SubAgentRunModel.parent_id == agent_id,
                    SubAgentRunModel.parent_message_id == message_id,
                )
                .all()
            )
        ]
        if not root_ids:
            return 0

        to_delete: Set[uuid.UUID] = set(root_ids)
        frontier = list(root_ids)

        while frontier:
            child_ids = [
                row[0]
                for row in (
                    db.query(SubAgentRunModel.id)
                    .filter(
                        SubAgentRunModel.project_id == project_id,
                        SubAgentRunModel.agent_id == agent_id,
                        SubAgentRunModel.parent_type == "sub_agent",
                        SubAgentRunModel.parent_id.in_(frontier),
                    )
                    .all()
                )
            ]

            next_frontier: List[uuid.UUID] = []
            for child_id in child_ids:
                if child_id in to_delete:
                    continue
                to_delete.add(child_id)
                next_frontier.append(child_id)
            frontier = next_frontier

        db.query(SubAgentRunModel).filter(
            SubAgentRunModel.id.in_(list(to_delete))
        ).delete(synchronize_session=False)
        return len(to_delete)


sub_agent_run_service = SubAgentRunService()
