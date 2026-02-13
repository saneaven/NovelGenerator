"""Run tool call service for unified runtime."""

from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models.db_models import AgentRunModel, RunMessageModel, RunToolCallModel
from ..schemas.runs import UpsertRunToolCallsRequest


class RunToolCallService:
    def _get_run_and_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        message_id: uuid.UUID,
    ) -> tuple[AgentRunModel, RunMessageModel]:
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

        message = (
            db.query(RunMessageModel)
            .filter(
                RunMessageModel.id == message_id,
                RunMessageModel.run_id == run.id,
            )
            .first()
        )
        if not message:
            raise ValueError("Run message not found")
        return run, message

    def upsert_run_tool_calls(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        message_id: uuid.UUID,
        data: UpsertRunToolCallsRequest,
    ) -> list[RunToolCallModel]:
        run, message = self._get_run_and_message(
            db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=message_id,
        )

        existing = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.message_id == message.id)
            .all()
        )
        by_llm_call_id = {row.llm_call_id: row for row in existing}
        incoming_ids = {item.llm_call_id for item in data.tool_calls}

        # Remove stale rows not present in current batch
        stale_ids = [row.id for row in existing if row.llm_call_id not in incoming_ids]
        if stale_ids:
            db.query(RunToolCallModel).filter(RunToolCallModel.id.in_(stale_ids)).delete(synchronize_session=False)

        now = datetime.utcnow()
        for item in data.tool_calls:
            row = by_llm_call_id.get(item.llm_call_id)
            if row is None:
                row = RunToolCallModel(
                    id=uuid.uuid4(),
                    run_id=run.id,
                    message_id=message.id,
                    llm_call_id=item.llm_call_id,
                    call_seq=item.call_seq,
                    tool_name=item.tool_name,
                    arguments=item.arguments,
                    status=item.status,
                    failure_type=item.failure_type,
                    reason=item.reason,
                    result=item.result,
                    accepted_at=item.accepted_at,
                    created_at=now,
                    updated_at=now,
                )
                db.add(row)
                continue

            row.call_seq = item.call_seq
            row.tool_name = item.tool_name
            row.arguments = item.arguments
            row.status = item.status
            row.failure_type = item.failure_type
            row.reason = item.reason
            row.result = item.result
            row.accepted_at = item.accepted_at
            row.updated_at = now
            flag_modified(row, "arguments")
            if item.result is not None:
                flag_modified(row, "result")

        db.commit()

        return (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.message_id == message.id)
            .order_by(RunToolCallModel.call_seq.asc(), RunToolCallModel.created_at.asc())
            .all()
        )


run_tool_call_service = RunToolCallService()

