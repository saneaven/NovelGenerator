"""RAG models (pgvector-backed).

This project is early-stage; we intentionally keep the schema minimal:
- Per project/object sources with deterministic ordering metadata.
- Chunk table stores embeddings as pgvector `vector` (no ANN index in MVP).
"""

from __future__ import annotations

from datetime import datetime
import os
import sys
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.types import UserDefinedType

# Add parent directory to path to import database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import Base  # noqa: E402


class Vector(UserDefinedType):
    """Minimal pgvector type (avoids extra dependency in early dev)."""

    cache_ok = True

    def get_col_spec(self, **kw):  # type: ignore[override]
        return "vector"

    def bind_processor(self, dialect):  # type: ignore[override]
        def process(value):
            if value is None:
                return None
            if isinstance(value, str):
                return value
            # pgvector accepts string form: '[1,2,3]'
            return "[" + ",".join(str(float(x)) for x in value) + "]"

        return process


class RagSource(Base):
    __tablename__ = "rag_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)

    object_type = Column(String(50), nullable=False)
    object_id = Column(UUID(as_uuid=True), nullable=False)
    language = Column(String(50), nullable=False)

    version_number = Column(Integer, nullable=True)
    content_hash = Column(String(64), nullable=True)
    index_state = Column(String(40), nullable=False, default="ready")  # ready|missing_main_language|error
    indexed_at = Column(DateTime, nullable=True)

    # Ordering metadata
    type_group = Column(String(30), nullable=False)  # story_object|outline|manuscript
    story_object_type = Column(String(50), nullable=True)
    story_object_order = Column(Integer, nullable=True)
    outline_order = Column(Integer, nullable=True)
    act_order = Column(Integer, nullable=True)
    chapter_order = Column(Integer, nullable=True)
    chapter_id = Column(UUID(as_uuid=True), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    chunks = relationship("RagChunk", back_populates="source", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id", "project_id", "object_type", "object_id", "language", name="uq_rag_source_identity"),
        Index("ix_rag_sources_project_group_order", "project_id", "type_group", "outline_order", "act_order", "chapter_order", "story_object_order"),
    )


class RagChunk(Base):
    __tablename__ = "rag_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("rag_sources.id", ondelete="CASCADE"), nullable=False, index=True)

    chunk_index = Column(Integer, nullable=False)
    field_path = Column(Text, nullable=False)
    text = Column(Text, nullable=False)

    embedding = Column(Vector, nullable=False)
    embedding_dim = Column(Integer, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    source = relationship("RagSource", back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("source_id", "chunk_index", name="uq_rag_chunk_index"),
    )


__all__ = ["RagSource", "RagChunk"]
