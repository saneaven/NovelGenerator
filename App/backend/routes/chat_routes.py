"""Chat and message routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List
import uuid

from ..database import get_db
from ..models.db_models import User, Project, Chat, ChatMessage
from ..schemas.chats import (
    ChatCreate, ChatUpdate, ChatResponse,
    MessageCreate, MessageUpdate, MessageResponse,
    ChatWithMessagesResponse
)
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/projects/{project_id}/chats", tags=["Chats"])


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
# CHAT MANAGEMENT
# ============================================================================

@router.post("", response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
async def create_chat(
    project_id: uuid.UUID,
    data: ChatCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new chat conversation"""
    project = await verify_project_access(project_id, current_user, db)

    chat = Chat(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name
    )

    db.add(chat)
    db.commit()
    db.refresh(chat)

    return chat


@router.get("", response_model=List[ChatResponse])
async def list_chats(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all chats for a project with their messages"""
    project = await verify_project_access(project_id, current_user, db)

    chats = db.query(Chat).filter(Chat.project_id == project_id).all()

    # Eagerly load messages for each chat
    # SQLAlchemy relationship already handles this via the relationship definition
    return chats


@router.get("/{chat_id}", response_model=ChatWithMessagesResponse)
async def get_chat_with_messages(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chat with all messages"""
    project = await verify_project_access(project_id, current_user, db)

    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.project_id == project_id
    ).first()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found"
        )

    messages = db.query(ChatMessage).filter(
        ChatMessage.chat_id == chat_id
    ).order_by(ChatMessage.created_at).all()

    return {"chat": chat, "messages": messages}


@router.put("/{chat_id}", response_model=ChatResponse)
async def update_chat(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    data: ChatUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update chat name"""
    project = await verify_project_access(project_id, current_user, db)

    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.project_id == project_id
    ).first()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found"
        )

    chat.name = data.name
    db.commit()
    db.refresh(chat)

    return chat


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a chat and all its messages"""
    project = await verify_project_access(project_id, current_user, db)

    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.project_id == project_id
    ).first()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found"
        )

    db.delete(chat)
    db.commit()

    return None


# ============================================================================
# MESSAGE MANAGEMENT
# ============================================================================

@router.post("/{chat_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a message to a chat"""
    project = await verify_project_access(project_id, current_user, db)

    # Verify chat exists
    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.project_id == project_id
    ).first()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found"
        )

    message = ChatMessage(
        id=uuid.uuid4(),
        chat_id=chat_id,
        role=data.role,
        data={
            data.language: {
                'content': data.content
            }
        },
        function_calls=data.function_calls
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    return message


@router.get("/{chat_id}/messages", response_model=List[MessageResponse])
async def list_messages(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all messages in a chat"""
    project = await verify_project_access(project_id, current_user, db)

    # Verify chat exists
    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.project_id == project_id
    ).first()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found"
        )

    messages = db.query(ChatMessage).filter(
        ChatMessage.chat_id == chat_id
    ).order_by(ChatMessage.created_at).all()

    return messages


@router.put("/{chat_id}/messages/{message_id}", response_model=MessageResponse)
async def update_message(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    data: MessageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a message"""
    project = await verify_project_access(project_id, current_user, db)

    message = db.query(ChatMessage).filter(
        ChatMessage.id == message_id,
        ChatMessage.chat_id == chat_id
    ).first()

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )

    # Update message data for the specified language
    if data.language not in message.data:
        message.data[data.language] = {}

    message.data[data.language]['content'] = data.content
    flag_modified(message, "data")

    # Update function calls if provided
    if data.function_calls is not None:
        message.function_calls = data.function_calls  # type: ignore
        flag_modified(message, "function_calls")

    db.commit()
    db.refresh(message)

    return message


@router.delete("/{chat_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    project_id: uuid.UUID,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a message"""
    project = await verify_project_access(project_id, current_user, db)

    message = db.query(ChatMessage).filter(
        ChatMessage.id == message_id,
        ChatMessage.chat_id == chat_id
    ).first()

    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )

    db.delete(message)
    db.commit()

    return None
