"""Message long-term memory models (pgvector-backed).

These tables store:
- Rolling summaries of archived conversations scoped to a thread.
- Vector index for archived thread messages.

Embedding profile is configured from the resolved `user_settings.search_memory_settings` Memory target.
"""

from __future__ import annotations

from datetime import datetime
import os
import sys
import uuid

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

# Add parent directory to path to import database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import Base  # noqa: E402

from .semantic_models import Vector  # noqa: E402


class MessageMemorySummary(Base):
    __tablename__ = "message_memory_summaries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)

    language = Column(String(50), nullable=False)
    to_message_id = Column(UUID(as_uuid=True), ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False)
    to_seq_in_thread = Column(BigInteger, nullable=True)
    summary_text = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("ix_message_memory_summaries_thread_to_message", "thread_id", "to_message_id"),
        Index("ix_message_memory_summaries_thread_to_seq", "thread_id", "to_seq_in_thread"),
    )


class MessageSemanticSource(Base):
    __tablename__ = "message_semantic_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)

    message_id = Column(UUID(as_uuid=True), ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(50), nullable=False)

    content_hash = Column(String(64), nullable=True)
    index_state = Column(String(40), nullable=False, default="ready")  # ready|error
    indexed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    chunks = relationship("MessageSemanticChunk", back_populates="source", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "thread_id",
            "message_id",
            "language",
            name="uq_message_semantic_source_identity",
        ),
        Index("ix_message_semantic_sources_thread_language", "thread_id", "language"),
    )


class MessageSemanticChunk(Base):
    __tablename__ = "message_semantic_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(
        UUID(as_uuid=True),
        ForeignKey("message_semantic_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    chunk_index = Column(Integer, nullable=False)
    field_path = Column(Text, nullable=False)
    text = Column(Text, nullable=False)

    embedding = Column(Vector, nullable=False)
    embedding_dim = Column(Integer, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    source = relationship("MessageSemanticSource", back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("source_id", "chunk_index", name="uq_message_semantic_chunk_index"),
    )


__all__ = ["MessageMemorySummary", "MessageSemanticSource", "MessageSemanticChunk"]
