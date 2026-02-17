"""Agent routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid

from ..database import get_db
from ..models.db_models import User, Project, Agent, Thread
from ..schemas.agents import AgentCreate, AgentUpdate, AgentResponse
from ..auth import get_current_user

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


def _find_thread_id(db: Session, agent_id: uuid.UUID) -> uuid.UUID | None:
    """Find the thread for an agent."""
    row = (
        db.query(Thread.id)
        .filter(Thread.owner_id == agent_id, Thread.thread_type == "agent")
        .first()
    )
    return row[0] if row else None


def _agent_to_response(agent: Agent, thread_id: uuid.UUID | None) -> dict:
    """Convert an Agent row + resolved thread_id to a response dict."""
    return {
        "id": agent.id,
        "project_id": agent.project_id,
        "name": agent.name,
        "thread_id": thread_id,
        "archived_until_message_id": agent.archived_until_message_id,
        "created_at": agent.created_at,
        "updated_at": agent.updated_at,
    }


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
    """Create a new agent conversation (auto-creates a thread)."""
    project = await verify_project_access(project_id, current_user, db)

    agent = Agent(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name
    )
    db.add(agent)
    db.flush()

    # Auto-create thread for this agent
    thread = Thread(
        project_id=project_id,
        user_id=current_user.id,
        thread_type="agent",
        owner_id=agent.id,
        status="done",
    )
    db.add(thread)
    db.commit()
    db.refresh(agent)

    return _agent_to_response(agent, thread.id)


@router.get("", response_model=List[AgentResponse])
async def list_agents(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all agents for a project"""
    project = await verify_project_access(project_id, current_user, db)

    agents = db.query(Agent).filter(
        Agent.project_id == project_id
    ).all()

    # Batch-load thread IDs for all agents
    agent_ids = [a.id for a in agents]
    thread_rows = (
        db.query(Thread.owner_id, Thread.id)
        .filter(Thread.owner_id.in_(agent_ids), Thread.thread_type == "agent")
        .all()
    ) if agent_ids else []
    thread_id_by_agent = {row[0]: row[1] for row in thread_rows}

    return [_agent_to_response(a, thread_id_by_agent.get(a.id)) for a in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get agent by ID"""
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

    return _agent_to_response(agent, _find_thread_id(db, agent.id))


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

    return _agent_to_response(agent, _find_thread_id(db, agent.id))


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an agent and all its runs"""
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
