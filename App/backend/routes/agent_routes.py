"""Agent and message routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified
from typing import List
import uuid

from ..database import get_db
from ..models.db_models import User, Project, Agent, AgentMessage
from ..schemas.agents import (
    AgentCreate, AgentUpdate, AgentResponse,
    MessageCreate, MessageUpdate, MessageResponse,
    AgentWithMessagesResponse
)
from ..auth import get_current_user
from ..services.sub_agent_invocation_service import sub_agent_invocation_service

router = APIRouter(prefix="/api/v1/projects/{project_id}/agents", tags=["Agents"])


# Helper function to verify project ownership
async def verify_project_access(
    project_id: uuid.UUID,
    current_user: User,
    db: Session
) -> Project:
    """Verify that the current user owns the project"""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    return project


# ============================================================================
# AGENT MANAGEMENT
# ============================================================================

@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(
    project_id: uuid.UUID,
    data: AgentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new agent conversation"""
    project = await verify_project_access(project_id, current_user, db)

    agent = Agent(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name
    )

    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Eagerly load messages (will be empty for new agent) to ensure consistent serialization
    agent = db.query(Agent).filter(Agent.id == agent.id).options(joinedload(Agent.messages)).first()

    return agent


@router.get("", response_model=List[AgentResponse])
async def list_agents(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all agents for a project with their messages"""
    project = await verify_project_access(project_id, current_user, db)

    # Eagerly load messages to avoid lazy-loading issues during serialization
    agents = db.query(Agent).filter(
        Agent.project_id == project_id
    ).options(
        joinedload(Agent.messages)
    ).all()

    return agents


@router.get("/{agent_id}", response_model=AgentWithMessagesResponse)
async def get_agent_with_messages(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get agent with all messages"""
    project = await verify_project_access(project_id, current_user, db)

    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.project_id == project_id
    ).first()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    messages = db.query(AgentMessage).filter(
        AgentMessage.agent_id == agent_id
    ).order_by(AgentMessage.seq).all()

    return {"agent": agent, "messages": messages}


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: AgentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update agent name"""
    project = await verify_project_access(project_id, current_user, db)

    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.project_id == project_id
    ).first()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    agent.name = data.name
    db.commit()
    db.refresh(agent)

    # Eagerly load messages to ensure consistent serialization
    db.query(Agent).filter(Agent.id == agent_id).options(joinedload(Agent.messages)).first()

    return agent


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an agent and all its messages"""
    project = await verify_project_access(project_id, current_user, db)

    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.project_id == project_id
    ).first()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    db.delete(agent)
    db.commit()

    return None


# ============================================================================
# MESSAGE MANAGEMENT
# ============================================================================

@router.post("/{agent_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a message to an agent"""
    project = await verify_project_access(project_id, current_user, db)

    # Verify agent exists (lock row for stable per-agent seq allocation)
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.project_id == project_id)
        .with_for_update()
        .first()
    )

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    message_data = {
        data.language: {}
    }

    if data.content_parts:
        message_data[data.language]['contentParts'] = [
            part.model_dump() for part in data.content_parts
        ]

    if data.thinking_details:
        message_data[data.language]['thinking_details'] = data.thinking_details

    message_seq = int(getattr(agent, "next_message_seq", 1) or 1)
    agent.next_message_seq = message_seq + 1

    message = AgentMessage(
        id=uuid.uuid4(),
        agent_id=agent_id,
        seq=message_seq,
        role=data.role,
        data=message_data,
        tool_calls=jsonable_encoder(data.tool_calls) if data.tool_calls is not None else None
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    return message


@router.get("/{agent_id}/messages", response_model=List[MessageResponse])
async def list_messages(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all messages in an agent"""
    project = await verify_project_access(project_id, current_user, db)

    # Verify agent exists
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.project_id == project_id
    ).first()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    messages = db.query(AgentMessage).filter(
        AgentMessage.agent_id == agent_id
    ).order_by(AgentMessage.seq).all()

    return messages


@router.put("/{agent_id}/messages/{message_id}", response_model=MessageResponse)
async def update_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    message_id: uuid.UUID,
    data: MessageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a message"""
    project = await verify_project_access(project_id, current_user, db)

    message = db.query(AgentMessage).filter(
        AgentMessage.id == message_id,
        AgentMessage.agent_id == agent_id
    ).first()

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )

    # Update message data for the specified language
    # Must copy data dict to trigger SQLAlchemy change detection
    message_data = dict(message.data)  # type: ignore

    if data.language not in message_data:
        message_data[data.language] = {}

    if data.content_parts:
        message_data[data.language]['contentParts'] = [
            part.model_dump() for part in data.content_parts
        ]

    if data.thinking_details is not None:
        message_data[data.language]['thinking_details'] = data.thinking_details

    message.data = message_data  # type: ignore
    flag_modified(message, "data")

    # Update tool calls if provided
    if data.tool_calls is not None:
        message.tool_calls = jsonable_encoder(data.tool_calls)  # type: ignore
        flag_modified(message, "tool_calls")

    db.commit()
    db.refresh(message)

    return message


@router.delete("/{agent_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a message"""
    project = await verify_project_access(project_id, current_user, db)

    message = db.query(AgentMessage).filter(
        AgentMessage.id == message_id,
        AgentMessage.agent_id == agent_id
    ).first()

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )

    # Cleanup persisted Sub Agent invocation trees rooted at this agent message.
    sub_agent_invocation_service.delete_tree_for_agent_message(
        db=db,
        project_id=project_id,
        agent_id=agent_id,
        message_id=message_id,
    )

    db.delete(message)
    db.commit()

    return None
