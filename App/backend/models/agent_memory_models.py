"""Agent long-term memory models (pgvector-backed).

These tables store:
- Rolling summaries of archived agent conversations.
- Vector index for archived agent messages (separate from project knowledge RAG).

Embedding profile is configured in `user_settings.embedding_configs["agentMemory"]`.
"""

from __future__ import annotations

from datetime import datetime
import os
import sys
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

# Add parent directory to path to import database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import Base  # noqa: E402

from .rag_models import Vector  # noqa: E402


class AgentMemorySummary(Base):
    __tablename__ = "agent_memory_summaries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)

    language = Column(String(50), nullable=False)
    to_message_id = Column(UUID(as_uuid=True), ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False)
    summary_text = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    agent = relationship("Agent")

    __table_args__ = (
        Index("ix_agent_memory_summaries_agent_to_message", "agent_id", "to_message_id"),
    )


class AgentRagSource(Base):
    __tablename__ = "agent_rag_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)

    message_id = Column(UUID(as_uuid=True), ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(50), nullable=False)

    content_hash = Column(String(64), nullable=True)
    index_state = Column(String(40), nullable=False, default="ready")  # ready|error
    indexed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    chunks = relationship("AgentRagChunk", back_populates="source", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id", "agent_id", "message_id", "language", name="uq_agent_rag_source_identity"),
        Index("ix_agent_rag_sources_agent_language", "agent_id", "language"),
    )


class AgentRagChunk(Base):
    __tablename__ = "agent_rag_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("agent_rag_sources.id", ondelete="CASCADE"), nullable=False, index=True)

    chunk_index = Column(Integer, nullable=False)
    field_path = Column(Text, nullable=False)
    text = Column(Text, nullable=False)

    embedding = Column(Vector, nullable=False)
    embedding_dim = Column(Integer, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    source = relationship("AgentRagSource", back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("source_id", "chunk_index", name="uq_agent_rag_chunk_index"),
    )


__all__ = ["AgentMemorySummary", "AgentRagSource", "AgentRagChunk"]
