"""
New Translation System Models - Ground-Up Redesign

Two-layer architecture:
1. Core Objects (structure only - in db_models.py)
2. Version History (this file - source of truth)
"""
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Index, UniqueConstraint
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
# VERSION HISTORY (Source of Truth)
# ============================================================================

class ObjectVersion(Base):
    """
    Immutable version history - THE single source of truth.
    Each version stores language-keyed data for an object.

    Note: User edits may create a new version containing only the edited language
    (other languages become stale until re-translated). Translation endpoints
    typically update the latest version in-place to add missing languages.

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
