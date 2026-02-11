"""Service for persistent Sub Agent invocation states."""

from __future__ import annotations

from datetime import datetime
import uuid
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session

from ..models.db_models import (
    AgentMessage,
    SubAgentInvocationMessageModel,
    SubAgentInvocationModel,
)
from ..schemas.sub_agent_invocations import (
    SubAgentInvocationQueryByMessagesRequest,
    SubAgentInvocationStateRequest,
)


class SubAgentInvocationService:
    """Persistence and query logic for Sub Agent invocations."""

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
            parent_invocation = (
                db.query(SubAgentInvocationModel)
                .filter(
                    SubAgentInvocationModel.id == parent_id,
                    SubAgentInvocationModel.project_id == project_id,
                    SubAgentInvocationModel.agent_id == agent_id,
                )
                .first()
            )
            if not parent_invocation:
                raise ValueError("Invalid parent: parent Sub Agent invocation not found")

            parent_message = (
                db.query(SubAgentInvocationMessageModel)
                .filter(
                    SubAgentInvocationMessageModel.id == parent_message_id,
                    SubAgentInvocationMessageModel.invocation_id == parent_invocation.id,
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

    @staticmethod
    def _parse_status_filter(values: Optional[Iterable[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        return cleaned if cleaned else None

    def upsert_state(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: SubAgentInvocationStateRequest,
    ) -> SubAgentInvocationModel:
        self._validate_parent(
            db,
            project_id=project_id,
            agent_id=agent_id,
            parent_type=data.parent_type,
            parent_id=data.parent_id,
            parent_message_id=data.parent_message_id,
            parent_tool_call_id=data.parent_tool_call_id,
        )

        invocation = (
            db.query(SubAgentInvocationModel)
            .filter(
                SubAgentInvocationModel.parent_type == data.parent_type,
                SubAgentInvocationModel.parent_id == data.parent_id,
                SubAgentInvocationModel.parent_message_id == data.parent_message_id,
                SubAgentInvocationModel.parent_tool_call_id == data.parent_tool_call_id,
                SubAgentInvocationModel.project_id == project_id,
                SubAgentInvocationModel.agent_id == agent_id,
            )
            .with_for_update()
            .first()
        )

        if not invocation:
            invocation = SubAgentInvocationModel(
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
                final_output=data.final_output,
                error=data.error,
            )
            db.add(invocation)
            db.flush()
        else:
            invocation.sub_agent_id = data.sub_agent_id
            invocation.agent_name = data.agent_name
            invocation.display_name = data.display_name
            invocation.caller = data.caller
            invocation.language = data.language
            invocation.input = data.input
            invocation.status = data.status
            invocation.final_output = data.final_output
            invocation.error = data.error

        existing_messages = (
            db.query(SubAgentInvocationMessageModel)
            .filter(SubAgentInvocationMessageModel.invocation_id == invocation.id)
            .order_by(SubAgentInvocationMessageModel.seq)
            .all()
        )
        existing_by_seq: Dict[int, SubAgentInvocationMessageModel] = {
            int(msg.seq): msg for msg in existing_messages
        }

        max_seq = len(data.history)
        for idx, message in enumerate(data.history, start=1):
            current = existing_by_seq.get(idx)
            if current:
                current.role = message.role
                current.content_parts = message.content_parts or []
                current.tool_calls = message.tool_calls
                current.thinking_details = message.thinking_details
                if message.created_at:
                    current.created_at = message.created_at
            else:
                db.add(
                    SubAgentInvocationMessageModel(
                        id=uuid.uuid4(),
                        invocation_id=invocation.id,
                        seq=idx,
                        role=message.role,
                        content_parts=message.content_parts or [],
                        tool_calls=message.tool_calls,
                        thinking_details=message.thinking_details,
                        created_at=message.created_at or datetime.utcnow(),
                    )
                )

        stale_ids = [msg.id for seq, msg in existing_by_seq.items() if seq > max_seq]
        if stale_ids:
            db.query(SubAgentInvocationMessageModel).filter(
                SubAgentInvocationMessageModel.id.in_(stale_ids)
            ).delete(synchronize_session=False)

        db.commit()

        stored = (
            db.query(SubAgentInvocationModel)
            .filter(SubAgentInvocationModel.id == invocation.id)
            .first()
        )
        if not stored:
            raise ValueError("Failed to load persisted Sub Agent invocation")

        stored.messages = (
            db.query(SubAgentInvocationMessageModel)
            .filter(SubAgentInvocationMessageModel.invocation_id == invocation.id)
            .order_by(SubAgentInvocationMessageModel.seq)
            .all()
        )
        return stored

    def query_by_root_agent_messages(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: SubAgentInvocationQueryByMessagesRequest,
    ) -> List[SubAgentInvocationModel]:
        if not data.message_ids:
            return []

        status_filter = self._parse_status_filter(data.status_filter)

        root_query = db.query(SubAgentInvocationModel).filter(
            SubAgentInvocationModel.project_id == project_id,
            SubAgentInvocationModel.agent_id == agent_id,
            SubAgentInvocationModel.parent_type == "agent",
            SubAgentInvocationModel.parent_id == agent_id,
            SubAgentInvocationModel.parent_message_id.in_(data.message_ids),
        )
        if status_filter:
            root_query = root_query.filter(SubAgentInvocationModel.status.in_(status_filter))

        roots = root_query.order_by(SubAgentInvocationModel.created_at, SubAgentInvocationModel.id).all()
        if not roots:
            return []

        ordered_ids: List[uuid.UUID] = []
        visited: Set[uuid.UUID] = set()
        all_by_id: Dict[uuid.UUID, SubAgentInvocationModel] = {}

        def add_items(items: List[SubAgentInvocationModel]) -> List[uuid.UUID]:
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
            child_query = db.query(SubAgentInvocationModel).filter(
                SubAgentInvocationModel.project_id == project_id,
                SubAgentInvocationModel.agent_id == agent_id,
                SubAgentInvocationModel.parent_type == "sub_agent",
                SubAgentInvocationModel.parent_id.in_(frontier),
            )
            if status_filter:
                child_query = child_query.filter(SubAgentInvocationModel.status.in_(status_filter))

            children = child_query.order_by(SubAgentInvocationModel.created_at, SubAgentInvocationModel.id).all()
            frontier = add_items(children)

        if not ordered_ids:
            return []

        grouped_messages: Dict[uuid.UUID, List[SubAgentInvocationMessageModel]] = {}
        for msg in (
            db.query(SubAgentInvocationMessageModel)
            .filter(SubAgentInvocationMessageModel.invocation_id.in_(ordered_ids))
            .order_by(SubAgentInvocationMessageModel.invocation_id, SubAgentInvocationMessageModel.seq)
            .all()
        ):
            grouped_messages.setdefault(msg.invocation_id, []).append(msg)

        result: List[SubAgentInvocationModel] = []
        for inv_id in ordered_ids:
            invocation = all_by_id[inv_id]
            invocation.messages = grouped_messages.get(inv_id, [])
            result.append(invocation)
        return result

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
                db.query(SubAgentInvocationModel.id)
                .filter(
                    SubAgentInvocationModel.project_id == project_id,
                    SubAgentInvocationModel.agent_id == agent_id,
                    SubAgentInvocationModel.parent_type == "agent",
                    SubAgentInvocationModel.parent_id == agent_id,
                    SubAgentInvocationModel.parent_message_id == message_id,
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
                    db.query(SubAgentInvocationModel.id)
                    .filter(
                        SubAgentInvocationModel.project_id == project_id,
                        SubAgentInvocationModel.agent_id == agent_id,
                        SubAgentInvocationModel.parent_type == "sub_agent",
                        SubAgentInvocationModel.parent_id.in_(frontier),
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

        db.query(SubAgentInvocationModel).filter(
            SubAgentInvocationModel.id.in_(list(to_delete))
        ).delete(synchronize_session=False)
        return len(to_delete)


sub_agent_invocation_service = SubAgentInvocationService()
