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

    # DEPRECATED: Keep for backward compatibility during migration
    active_provider = Column(String(50), default='openrouter')
    ai_model = Column(String(100), default='gpt-5-mini')
    providers_config = Column(JSONB, server_default='{}')
    provider_preferences = Column(JSONB, server_default='{}')

    # NEW: Function-based configuration (provider, model, temperature, advanced settings per function)
    function_configs = Column(JSONB, nullable=False, server_default="""{
        "chat": {"provider": "openrouter", "model": "gpt-4o-mini", "temperature": 0.7, "advanced": {"enablePrefill": false, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}},
        "translation": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.2, "advanced": {"enablePrefill": false, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}},
        "storyEdit": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.3, "advanced": {"enablePrefill": false, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}},
        "chapterGen": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.7, "advanced": {"enablePrefill": true, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}}
    }""")

    # NEW: Provider credentials (shared across functions)
    provider_credentials = Column(JSONB, nullable=False, server_default="""{
        "openai": {"apiKey": ""},
        "gemini": {"apiKey": ""},
        "claude": {"apiKey": ""},
        "openrouter": {"apiKey": ""},
        "custom": {"baseUrl": "", "apiKey": ""},
        "xai": {"apiKey": ""}
    }""")

    # Language settings
    main_language = Column(String(50), default='English', nullable=False)
    sub_languages = Column(JSONB, server_default='[]')  # Array of strings
    default_sub_language = Column(String(50))  # For quick-translate, nullable

    # Theme settings
    theme = Column(String(20), default='system', nullable=False)

    # Retry configuration (global)
    retry_config = Column(JSONB, nullable=False, server_default="""{
        "enabled": true,
        "maxRetries": 3,
        "retryableStatusCodes": [429, 500, 502, 503, 504],
        "retryDelayMs": 1000
    }""")

    # Image generation configuration
    image_gen_config = Column(JSONB, nullable=False, server_default="""{
        "provider": "openai",
        "model": "gpt-image-1",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": null,
        "selectedTagBasedStyleId": null,
        "openaiSettings": {"quality": "standard", "style": "natural"},
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"}
    }""")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="settings")


# ============================================================================
# PROMPT VERSIONS
# ============================================================================

class PromptVersion(Base):
    """Version-controlled user-editable prompts"""
    __tablename__ = 'prompt_versions'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)

    # Prompt identification
    function_type = Column(String(50), nullable=False)  # 'chat', 'translation', 'storyEdit', 'chapterGen'
    prompt_category = Column(String(50), nullable=False)  # 'systemPrompt', 'prefill', 'userMessageTag'
    prompt_name = Column(String(50), nullable=True)  # 'workspace', 'novelEditor', etc (nullable for single prompts)

    # Version data
    content = Column(Text, nullable=False)
    version_number = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=False, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    note = Column(Text)

    # Relationships
    user = relationship("User")


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
    assets = relationship("Asset", back_populates="project", cascade="all, delete-orphan")


# ============================================================================
# STORY OBJECTS - BASIC INFO
# ============================================================================

class BasicInfo(Base):
    """Basic story information - structure only (content in object_translations)"""
    __tablename__ = 'basic_info'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="basic_info")


# ============================================================================
# STORY OBJECTS - NAME/DESCRIPTION ENTITIES
# ============================================================================

class Character(Base):
    """Character entities - structure only (content in object_translations)"""
    __tablename__ = 'characters'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="characters")


class Organization(Base):
    """Organization entities - structure only (content in object_translations)"""
    __tablename__ = 'organizations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="organizations")


class Location(Base):
    """Location entities - structure only (content in object_translations)"""
    __tablename__ = 'locations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="locations")


class LorebookEntry(Base):
    """Lorebook entries - structure only (content in object_translations)"""
    __tablename__ = 'lorebook_entries'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="lorebook_entries")


# ============================================================================
# OUTLINE STRUCTURE
# ============================================================================

class Outline(Base):
    """Story outline - structure only"""
    __tablename__ = 'outlines'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="outline")
    acts = relationship("Act", back_populates="outline", cascade="all, delete-orphan", order_by="Act.order")


class Act(Base):
    """Acts within an outline - structure only (content in object_translations)"""
    __tablename__ = 'acts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outline_id = Column(UUID(as_uuid=True), ForeignKey('outlines.id', ondelete='CASCADE'), nullable=False, index=True)

    order = Column(Integer, nullable=False)  # Structural data, not translatable

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    outline = relationship("Outline", back_populates="acts")
    chapters = relationship("Chapter", back_populates="act", cascade="all, delete-orphan", order_by="Chapter.order")


class Chapter(Base):
    """Chapters within an act - structure only (content in object_translations)"""
    __tablename__ = 'chapters'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    act_id = Column(UUID(as_uuid=True), ForeignKey('acts.id', ondelete='CASCADE'), nullable=False, index=True)

    order = Column(Integer, nullable=False)  # Structural data, not translatable

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    act = relationship("Act", back_populates="chapters")
    manuscript = relationship("Manuscript", back_populates="chapter", uselist=False, cascade="all, delete-orphan")


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
# MANUSCRIPT (Novel Writing - Chapter Content)
# ============================================================================

class Manuscript(Base):
    """Manuscript content for each chapter - structure only (content in object_translations)"""
    __tablename__ = 'manuscripts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chapter_id = Column(UUID(as_uuid=True), ForeignKey('chapters.id', ondelete='CASCADE'), nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    chapter = relationship("Chapter", back_populates="manuscript")
    versions = relationship("ManuscriptVersion", back_populates="manuscript", cascade="all, delete-orphan")


class ManuscriptVersion(Base):
    """Version history for manuscript content with multilingual support"""
    __tablename__ = 'manuscript_versions'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    manuscript_id = Column(UUID(as_uuid=True), ForeignKey('manuscripts.id', ondelete='CASCADE'), nullable=False, index=True)

    user_request = Column(Text)
    is_active = Column(Boolean, default=False, nullable=False)

    # Multilingual content stored as JSONB
    # Format: { "English": { "content": "...", "wordCount": 1234 }, "Korean": {...} }
    data = Column(JSONB, nullable=False)

    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    manuscript = relationship("Manuscript", back_populates="versions")


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


# ============================================================================
# ASSET MANAGEMENT
# ============================================================================

class Asset(Base):
    """Stores individual image assets for the project"""
    __tablename__ = 'assets'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)  # Local storage path
    thumbnail_path = Column(String(500), nullable=True)
    mime_type = Column(String(50), default='image/png', nullable=False)

    # Generation metadata - prompts are stored separately by type
    # Natural language providers (OpenAI, Gemini, xAI): use generation_prompt only
    # Tag-based providers (NovelAI): use generation_positive_prompt and generation_negative_prompt only
    generation_prompt = Column(Text, nullable=True)  # Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt = Column(Text, nullable=True)  # Positive prompt for tag-based (NovelAI)
    generation_negative_prompt = Column(Text, nullable=True)  # Negative prompt for tag-based (NovelAI)
    generation_provider = Column(String(50), nullable=True)  # 'openai', 'gemini', 'xai', 'novelai'
    generation_model = Column(String(100), nullable=True)
    generation_settings = Column(JSONB, nullable=True)  # Provider-specific settings (sampler, steps, etc.)

    # Image dimensions
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    file_size = Column(Integer, nullable=True)  # In bytes

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="assets")
    story_object_assets = relationship("StoryObjectAsset", back_populates="asset", cascade="all, delete-orphan")
    manuscript_images = relationship("ManuscriptImage", back_populates="asset", cascade="all, delete-orphan")


class StoryObjectAsset(Base):
    """Links assets to story objects (characters, locations)"""
    __tablename__ = 'story_object_assets'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Polymorphic reference to story object
    object_type = Column(String(50), nullable=False)  # 'character', 'location'
    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id', ondelete='CASCADE'), nullable=False, index=True)

    is_main = Column(Boolean, default=False, nullable=False)  # Main image shown in placeholder
    display_order = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    asset = relationship("Asset", back_populates="story_object_assets")

    __table_args__ = (
        Index('idx_story_object_asset', 'object_type', 'object_id'),
    )


class ManuscriptImage(Base):
    """Images embedded in manuscript content at specific positions"""
    __tablename__ = 'manuscript_images'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    manuscript_id = Column(UUID(as_uuid=True), ForeignKey('manuscripts.id', ondelete='CASCADE'), nullable=False, index=True)

    position = Column(Integer, nullable=False)  # Character position in text content

    # Image source - either direct asset or story object reference
    source_type = Column(String(20), nullable=False)  # 'asset' or 'story_object'
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id', ondelete='SET NULL'), nullable=True)

    # If source_type is 'story_object', reference the object
    story_object_type = Column(String(50), nullable=True)  # 'character', 'location'
    story_object_id = Column(UUID(as_uuid=True), nullable=True)

    # Generation metadata (for images generated specifically for this insertion)
    generation_prompt = Column(Text, nullable=True)

    # Display settings
    display_width = Column(Integer, default=400, nullable=False)
    caption = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    asset = relationship("Asset", back_populates="manuscript_images")
