"""SQLAlchemy database models for Novel Generator"""
from sqlalchemy import Column, String, Integer, DateTime, Boolean, Text, ForeignKey, Index
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
# USER & AUTHENTICATION
# ============================================================================

class User(Base):
    """User account - central entity for all data"""
    __tablename__ = 'users'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime)

    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)

    # Relationships
    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("UserSettings", back_populates="user", uselist=False, cascade="all, delete-orphan")


# ============================================================================
# USER SETTINGS
# ============================================================================

class UserSettings(Base):
    """User preferences and settings"""
    __tablename__ = 'user_settings'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)

    # Active provider
    active_provider = Column(String(50), default='copilot', nullable=False)
    ai_model = Column(String(100), default='gpt-5-mini', nullable=False)

    # Provider configurations (stored as JSONB)
    providers_config = Column(JSONB, nullable=False, server_default='{}')

    # Provider preferences for OpenRouter models
    provider_preferences = Column(JSONB, server_default='{}')

    # Language settings
    primary_language = Column(String(50), default='English', nullable=False)
    secondary_language = Column(String(50))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="settings")


# ============================================================================
# PROJECTS
# ============================================================================

class Project(Base):
    """Story projects owned by users"""
    __tablename__ = 'projects'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    description = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="projects")
    basic_info = relationship("BasicInfo", back_populates="project", uselist=False, cascade="all, delete-orphan")
    characters = relationship("Character", back_populates="project", cascade="all, delete-orphan")
    organizations = relationship("Organization", back_populates="project", cascade="all, delete-orphan")
    locations = relationship("Location", back_populates="project", cascade="all, delete-orphan")
    lorebook_entries = relationship("LorebookEntry", back_populates="project", cascade="all, delete-orphan")
    outline = relationship("Outline", back_populates="project", uselist=False, cascade="all, delete-orphan")
    chats = relationship("Chat", back_populates="project", cascade="all, delete-orphan")


# ============================================================================
# STORY OBJECTS - BASIC INFO
# ============================================================================

class BasicInfo(Base):
    """Basic story information (title, logline, genre)"""
    __tablename__ = 'basic_info'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True)

    # Current active data (flat fields for quick access)
    title = Column(String(500))
    logline = Column(Text)
    genre = Column(String(100))

    # Version tracking
    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="basic_info")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(BasicInfo.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='basic_info')",
                          cascade="all, delete-orphan",
                          viewonly=True)


# ============================================================================
# STORY OBJECTS - NAME/DESCRIPTION ENTITIES
# ============================================================================

class Character(Base):
    """Character entities"""
    __tablename__ = 'characters'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255))
    description = Column(Text)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="characters")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(Character.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='character')",
                          cascade="all, delete-orphan",
                          viewonly=True)


class Organization(Base):
    """Organization entities"""
    __tablename__ = 'organizations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255))
    description = Column(Text)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="organizations")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(Organization.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='organization')",
                          cascade="all, delete-orphan",
                          viewonly=True)


class Location(Base):
    """Location entities"""
    __tablename__ = 'locations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255))
    description = Column(Text)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="locations")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(Location.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='location')",
                          cascade="all, delete-orphan",
                          viewonly=True)


class LorebookEntry(Base):
    """Lorebook entries"""
    __tablename__ = 'lorebook_entries'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255))
    description = Column(Text)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="lorebook_entries")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(LorebookEntry.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='lorebook')",
                          cascade="all, delete-orphan",
                          viewonly=True)


# ============================================================================
# OUTLINE STRUCTURE
# ============================================================================

class Outline(Base):
    """Story outline"""
    __tablename__ = 'outlines'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="outline")
    acts = relationship("Act", back_populates="outline", cascade="all, delete-orphan", order_by="Act.order")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(Outline.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='outline')",
                          cascade="all, delete-orphan",
                          viewonly=True)


class Act(Base):
    """Acts within an outline"""
    __tablename__ = 'acts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outline_id = Column(UUID(as_uuid=True), ForeignKey('outlines.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255))
    description = Column(Text)
    order = Column(Integer, nullable=False)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    outline = relationship("Outline", back_populates="acts")
    chapters = relationship("Chapter", back_populates="act", cascade="all, delete-orphan", order_by="Chapter.order")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(Act.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='act')",
                          cascade="all, delete-orphan",
                          viewonly=True)


class Chapter(Base):
    """Chapters within an act"""
    __tablename__ = 'chapters'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    act_id = Column(UUID(as_uuid=True), ForeignKey('acts.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255))
    description = Column(Text)
    order = Column(Integer, nullable=False)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    act = relationship("Act", back_populates="chapters")
    content = relationship("ChapterContent", back_populates="chapter", uselist=False, cascade="all, delete-orphan")
    versions = relationship("StoryObjectVersion",
                          foreign_keys="[StoryObjectVersion.object_id]",
                          primaryjoin="and_(Chapter.id==StoryObjectVersion.object_id, StoryObjectVersion.object_type=='chapter')",
                          cascade="all, delete-orphan",
                          viewonly=True)


# ============================================================================
# VERSION HISTORY (for Story Objects)
# ============================================================================

class StoryObjectVersion(Base):
    """Version history for all story objects with multilingual support"""
    __tablename__ = 'story_object_versions'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    object_type = Column(String(50), nullable=False, index=True)

    user_request = Column(Text)
    is_active = Column(Boolean, default=False, nullable=False)

    # Multilingual data stored as JSONB
    # Format: { "English": { "name": "...", "description": "..." }, "Korean": {...} }
    data = Column(JSONB, nullable=False)

    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('idx_version_object_type', 'object_id', 'object_type'),
    )


# ============================================================================
# CHAPTER CONTENT (Novel Writing)
# ============================================================================

class ChapterContent(Base):
    """Content for each chapter with version history"""
    __tablename__ = 'chapter_contents'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chapter_id = Column(UUID(as_uuid=True), ForeignKey('chapters.id', ondelete='CASCADE'), nullable=False, unique=True)

    active_version_id = Column(UUID(as_uuid=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    chapter = relationship("Chapter", back_populates="content")
    versions = relationship("ChapterContentVersion", back_populates="chapter_content", cascade="all, delete-orphan")


class ChapterContentVersion(Base):
    """Version history for chapter content with multilingual support"""
    __tablename__ = 'chapter_content_versions'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chapter_content_id = Column(UUID(as_uuid=True), ForeignKey('chapter_contents.id', ondelete='CASCADE'), nullable=False, index=True)

    user_request = Column(Text)
    is_active = Column(Boolean, default=False, nullable=False)

    # Multilingual content stored as JSONB
    # Format: { "English": { "content": "...", "wordCount": 1234 }, "Korean": {...} }
    data = Column(JSONB, nullable=False)

    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    chapter_content = relationship("ChapterContent", back_populates="versions")


# ============================================================================
# CHAT SYSTEM
# ============================================================================

class Chat(Base):
    """Chat conversations per project"""
    __tablename__ = 'chats'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="chats")
    messages = relationship("ChatMessage", back_populates="chat", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    """Chat messages with multilingual support and function calls"""
    __tablename__ = 'chat_messages'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id = Column(UUID(as_uuid=True), ForeignKey('chats.id', ondelete='CASCADE'), nullable=False, index=True)

    role = Column(String(50), nullable=False)

    # Multilingual content stored as JSONB
    # Format: { "English": { "content": "..." }, "Korean": { "content": "..." } }
    data = Column(JSONB, nullable=False)

    # Function calls metadata (if any) stored as JSONB array
    function_calls = Column(JSONB)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    chat = relationship("Chat", back_populates="messages")
