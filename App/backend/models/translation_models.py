"""
New Translation System Models - Ground-Up Redesign

Three-layer architecture:
1. Core Objects (structure only - in db_models.py)
2. Translation Cache (this file - fast queries)
3. Version History (this file - source of truth)
"""
from sqlalchemy import Column, String, Integer, DateTime, Boolean, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid
import sys
import os

# Add parent directory to path to import database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import Base


# ============================================================================
# LAYER 2: TRANSLATION CACHE (Fast Access)
# ============================================================================

class ObjectTranslation(Base):
    """
    Translation cache for fast querying and filtering.
    One row per object per language.
    Auto-generated from version data.

    Examples:
    - Character "John" in English: {name: "John Doe", description: "Hero..."}
    - Same character in Korean: {name: "존 도", description: "영웅..."}
    """
    __tablename__ = 'object_translations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Object identification
    object_type = Column(String(50), nullable=False, index=True)
    # Types: 'basic_info', 'character', 'organization', 'location',
    #        'lorebook', 'act', 'chapter', 'manuscript'

    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    # Language
    language = Column(String(50), nullable=False, index=True)

    # Translation data (flexible JSONB schema)
    # For characters: {name: "...", description: "..."}
    # For basic_info: {title: "...", logline: "...", genre: "..."}
    # For chapter_content: {content: "...", wordCount: 1234}
    data = Column(JSONB, nullable=False)

    # Active language flag (UI display)
    is_active = Column(Boolean, default=False, nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Constraints
    __table_args__ = (
        # One translation per object per language
        UniqueConstraint('object_type', 'object_id', 'language', name='uq_object_language'),

        # GIN index for fast JSONB queries (search by name, description, etc.)
        Index('ix_object_translations_data', 'data', postgresql_using='gin'),

        # Composite index for common queries
        Index('ix_object_translations_type_id_lang', 'object_type', 'object_id', 'language'),
        Index('ix_object_translations_type_active', 'object_type', 'is_active'),
    )

    def __repr__(self):
        return f"<ObjectTranslation {self.object_type}:{self.object_id} {self.language}>"


# ============================================================================
# LAYER 3: VERSION HISTORY (Source of Truth)
# ============================================================================

class ObjectVersion(Base):
    """
    Immutable version history - THE single source of truth.
    Each version contains ALL languages at that point in time.

    Example data structure:
    {
        "English": {
            "name": "John Doe",
            "description": "Hero of the story"
        },
        "Korean": {
            "name": "존 도",
            "description": "이야기의 영웅"
        }
    }
    """
    __tablename__ = 'object_versions'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Object identification
    object_type = Column(String(50), nullable=False, index=True)
    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    # Version number (sequential, 1-indexed)
    version_number = Column(Integer, nullable=False)

    # Multilingual data (ALL languages in one JSONB)
    # {language: {field: value, ...}, ...}
    data = Column(JSONB, nullable=False)

    # Metadata
    user_request = Column(Text)  # 'User Edit', 'AI Translation', 'AI Generation'
    created_by = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User")

    # Constraints
    __table_args__ = (
        # Unique version numbers per object
        UniqueConstraint('object_type', 'object_id', 'version_number', name='uq_object_version_number'),

        # Index for version queries (get latest, get all versions)
        Index('ix_object_versions_type_id_num', 'object_type', 'object_id', 'version_number'),

        # Index for ordering by creation time
        Index('ix_object_versions_created_at', 'created_at'),

        # GIN index for querying version data
        Index('ix_object_versions_data', 'data', postgresql_using='gin'),
    )

    def __repr__(self):
        return f"<ObjectVersion {self.object_type}:{self.object_id} v{self.version_number}>"


# ============================================================================
# NOTE: ActiveVersion table has been removed
# The system now uses MAX(version_number) as the active version
# See migration 012_drop_active_versions_table.py
# ============================================================================
