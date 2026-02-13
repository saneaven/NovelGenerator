"""Run message service for unified runtime."""

from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models.db_models import AgentRunModel, RunMessageModel
from ..schemas.runs import AddRunMessageRequest, PatchRunMessageRequest, TranslateRunMessageRequest


class RunMessageService:
    def _get_run(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        for_update: bool = False,
    ) -> AgentRunModel:
        query = db.query(AgentRunModel).filter(
            AgentRunModel.id == run_id,
            AgentRunModel.project_id == project_id,
            AgentRunModel.agent_id == agent_id,
        )
        if for_update:
            query = query.with_for_update()
        run = query.first()
        if not run:
            raise ValueError("Run not found")
        return run

    def add_run_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        data: AddRunMessageRequest,
    ) -> RunMessageModel:
        run = self._get_run(db, project_id=project_id, agent_id=agent_id, run_id=run_id, for_update=True)
        seq = int(run.next_message_seq or 1)
        run.next_message_seq = seq + 1

        lang_entry: dict = {}
        if data.content_parts:
            lang_entry["contentParts"] = list(data.content_parts)
        if data.thinking_details is not None:
            lang_entry["thinkingDetails"] = data.thinking_details

        message = RunMessageModel(
            id=uuid.uuid4(),
            run_id=run.id,
            seq=seq,
            role=data.role,
            data={data.language: lang_entry},
            created_at=datetime.utcnow(),
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    def patch_run_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        message_id: uuid.UUID,
        data: PatchRunMessageRequest,
    ) -> RunMessageModel:
        run = self._get_run(db, project_id=project_id, agent_id=agent_id, run_id=run_id, for_update=False)

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

        msg_data = dict(message.data or {})
        lang_entry = dict(msg_data.get(data.language) or {})

        if data.content_parts is not None:
            lang_entry["contentParts"] = list(data.content_parts)
        if data.thinking_details is not None:
            lang_entry["thinkingDetails"] = data.thinking_details

        msg_data[data.language] = lang_entry
        message.data = msg_data
        flag_modified(message, "data")

        db.commit()
        db.refresh(message)
        return message

    def translate_run_message(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        agent_id: uuid.UUID,
        run_id: uuid.UUID,
        message_id: uuid.UUID,
        data: TranslateRunMessageRequest,
    ) -> RunMessageModel:
        run = self._get_run(db, project_id=project_id, agent_id=agent_id, run_id=run_id, for_update=False)

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

        msg_data = dict(message.data or {})
        lang_entry: dict = {}
        if data.content_parts:
            lang_entry["contentParts"] = list(data.content_parts)
        if data.thinking_details is not None:
            lang_entry["thinkingDetails"] = data.thinking_details

        msg_data[data.language] = lang_entry
        message.data = msg_data
        flag_modified(message, "data")

        db.commit()
        db.refresh(message)
        return message


run_message_service = RunMessageService()
