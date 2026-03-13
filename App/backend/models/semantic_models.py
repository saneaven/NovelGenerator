"""Semantic search models (pgvector-backed).

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


class SemanticSource(Base):
    __tablename__ = "semantic_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)

    object_type = Column(String(50), nullable=False)
    object_id = Column(UUID(as_uuid=True), nullable=False)
    language = Column(String(50), nullable=False)

    content_hash = Column(String(64), nullable=True)
    indexed_provider = Column(String(50), nullable=True)
    indexed_model = Column(String(200), nullable=True)
    indexed_at = Column(DateTime, nullable=True)
    last_attempted_hash = Column(String(64), nullable=True)
    last_attempted_provider = Column(String(50), nullable=True)
    last_attempted_model = Column(String(200), nullable=True)
    last_error_at = Column(DateTime, nullable=True)
    last_error_message = Column(Text, nullable=True)

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

    chunks = relationship("SemanticChunk", back_populates="source", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "project_id",
            "object_type",
            "object_id",
            "language",
            name="uq_semantic_source_identity",
        ),
        Index(
            "ix_semantic_sources_project_group_order",
            "project_id",
            "type_group",
            "outline_order",
            "act_order",
            "chapter_order",
            "story_object_order",
        ),
    )


class SemanticChunk(Base):
    __tablename__ = "semantic_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("semantic_sources.id", ondelete="CASCADE"), nullable=False, index=True)

    chunk_index = Column(Integer, nullable=False)
    field_path = Column(Text, nullable=False)
    text = Column(Text, nullable=False)

    embedding = Column(Vector, nullable=False)
    embedding_dim = Column(Integer, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    source = relationship("SemanticSource", back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("source_id", "chunk_index", name="uq_semantic_chunk_index"),
    )


__all__ = ["SemanticSource", "SemanticChunk"]
