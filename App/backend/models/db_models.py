"""SQLAlchemy database models for Novel Buds"""
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

    # Task-based configuration (provider, model, temperature, advanced settings per task)
    task_configs = Column(JSONB, nullable=False, server_default="""{
        "agent": {"provider": "openrouter", "model": "gpt-4o-mini", "temperature": 0.7, "advanced": {"enablePrefill": false, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}},
        "translation": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.2, "advanced": {"enablePrefill": false, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}},
        "editAssistant": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.7, "advanced": {"enablePrefill": true, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}},
        "imagePrompt": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.7, "advanced": {"enablePrefill": false, "thinkingMode": "off", "thinkingConfig": {"effort": "medium"}}}
    }""")

    # NEW: Provider credentials (shared across functions)
    provider_credentials = Column(JSONB, nullable=False, server_default="""{
        "openai": {"apiKey": ""},
        "gemini": {"apiKey": ""},
        "claude": {"apiKey": ""},
        "openrouter": {"apiKey": ""},
        "custom": {"baseUrl": "", "apiKey": ""},
        "xai": {"apiKey": ""},
        "novelai": {"apiKey": ""}
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

    # Native output mode - use raw LLM output instead of tool calling
    native_output_mode = Column(Boolean, default=False, nullable=False)

    # RAG Search (embeddings + pgvector) enable toggle
    rag_search_enabled = Column(Boolean, default=False, nullable=False)

    # RAG Search defaults
    rag_search_top_k_per_query = Column(Integer, default=20, nullable=False)
    rag_search_neighbor_window = Column(Integer, default=0, nullable=False)
    rag_search_max_primary_chunks = Column(Integer, default=20, nullable=False)
    rag_search_max_total_chunks = Column(Integer, default=60, nullable=False)

    # Patch auto-retry - automatically retry with replace mode if patch fails
    patch_auto_retry = Column(Boolean, default=True, nullable=False)

    # LLM logging enabled - enable LLM request logging for debugging
    llm_logging_enabled = Column(Boolean, default=False, nullable=False)

    # Tool call history limit - number of recent assistant messages to include tool calls for
    tool_call_history_limit = Column(Integer, default=5, nullable=False)

    # Thinking history limit - number of recent assistant messages to include thinking for
    thinking_history_limit = Column(Integer, default=5, nullable=False)

    # Tool call auto-approve settings (all-or-none per assistant response)
    tool_call_auto_approve = Column(
        JSONB,
        nullable=False,
        default=lambda: {
            "create": False,
            "delete": False,
            "patch": False,
            "replace": False,
            "read": False,
            "search": False,
        },
    )

    # Display language for UI (content display language)
    display_language = Column(String(50), default='English', nullable=False)

    # UI Language for interface localization (i18next)
    ui_language = Column(String(10), default='en', nullable=False)

    # Active prompt preset
    active_preset_id = Column(UUID(as_uuid=True), ForeignKey('prompt_presets.id', ondelete='SET NULL'), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="settings")
    active_preset = relationship("PromptPreset", foreign_keys=[active_preset_id])


# ============================================================================
# USER CREDENTIAL VAULT (ENCRYPTED)
# ============================================================================

class UserCredentials(Base):
    """E2E-encrypted credentials backup blob stored server-side.

    The server stores an opaque encrypted blob and never decrypts it.
    """
    __tablename__ = "user_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Opaque encrypted blob (JSON string) produced client-side (E2E)
    credentials_blob = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")

# ============================================================================
# PROMPT PRESETS
# ============================================================================

class PromptPreset(Base):
    """Parent container for grouping prompts, fragments, and variables"""
    __tablename__ = 'prompt_presets'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)

    # Preset identification
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User")
    prompts = relationship("PromptVersion", back_populates="preset", cascade="all, delete-orphan")
    fragments = relationship("PromptFragment", back_populates="preset", cascade="all, delete-orphan")
    variables = relationship("PromptVariable", back_populates="preset", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('user_id', 'name', name='uq_preset_user_name'),
        Index('idx_preset_user', 'user_id'),
    )


# ============================================================================
# PROMPT VERSIONS
# ============================================================================

class PromptVersion(Base):
    """Version-controlled user-editable prompts"""
    __tablename__ = 'prompt_versions'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey('prompt_presets.id', ondelete='CASCADE'), nullable=False, index=True)

    # Prompt identification
    task_type = Column(String(50), nullable=False)  # 'agent', 'translation', 'editAssistant', 'imagePrompt'
    prompt_category = Column(String(50), nullable=False)  # 'systemPrompt', 'prefill', 'userMessageTag'
    prompt_name = Column(String(50), nullable=False)  # 'storyObject', 'novelEditor', etc (required)

    # Version data
    content = Column(Text, nullable=False)
    version_number = Column(Integer, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    note = Column(Text)

    # Relationships
    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="prompts")


# ============================================================================
# PROMPT FRAGMENTS
# ============================================================================

class PromptFragment(Base):
    """Reusable prompt fragments organized in folders with version control"""
    __tablename__ = 'prompt_fragments'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey('prompt_presets.id', ondelete='CASCADE'), nullable=False, index=True)

    # Fragment identification
    folder_path = Column(String(200), nullable=True)  # e.g., 'common', 'thinking/custom', null for root
    fragment_name = Column(String(100), nullable=False)

    # Content
    content = Column(Text, nullable=False)
    description = Column(Text, nullable=True)

    # Flags
    is_system_default = Column(Boolean, default=False, nullable=False)

    # Version control (same pattern as PromptVersion)
    version_number = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="fragments")


# ============================================================================
# PROMPT VARIABLES
# ============================================================================

class PromptVariable(Base):
    """User-defined prompt template variables"""
    __tablename__ = 'prompt_variables'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey('prompt_presets.id', ondelete='CASCADE'), nullable=False, index=True)

    # Variable identification
    name = Column(String(100), nullable=False)  # Variable name (e.g., 'writingStyle', 'isGeminiMode')

    # Variable type: 'string', 'number', 'boolean', 'select'
    var_type = Column(String(20), nullable=False)

    # Value storage as JSONB: {"value": <actual value>}
    value = Column(JSONB, nullable=False, server_default='{"value": null}')

    # Select options (only used when var_type='select')
    select_options = Column(JSONB, nullable=True)  # ["option1", "option2", ...]

    # Number options (only used when var_type='number')
    # Format: {"min": 0, "max": 100, "step": 1, "input_type": "slider" | "input"}
    number_options = Column(JSONB, nullable=True)

    # Description for UI display
    description = Column(Text, nullable=True)

    # Display order
    display_order = Column(Integer, default=0, nullable=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="variables")

    __table_args__ = (
        UniqueConstraint('preset_id', 'name', name='uq_variable_preset_name'),
        Index('idx_variable_preset_order', 'preset_id', 'display_order'),
    )


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
    guidelines = relationship("Guidelines", back_populates="project", uselist=False, cascade="all, delete-orphan")
    characters = relationship("Character", back_populates="project", cascade="all, delete-orphan")
    organizations = relationship("Organization", back_populates="project", cascade="all, delete-orphan")
    locations = relationship("Location", back_populates="project", cascade="all, delete-orphan")
    lorebook_entries = relationship("LorebookEntry", back_populates="project", cascade="all, delete-orphan")
    outlines = relationship("Outline", back_populates="project", cascade="all, delete-orphan", order_by="Outline.order")
    agents = relationship("Agent", back_populates="project", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="project", cascade="all, delete-orphan")


# ============================================================================
# STORY OBJECTS - BASIC INFO
# ============================================================================

class BasicInfo(Base):
    """Basic story information - structure only (content in object_versions)"""
    __tablename__ = 'basic_info'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="basic_info")


# ============================================================================
# STORY OBJECTS - GUIDELINES
# ============================================================================

class Guidelines(Base):
    """Project guidelines - structure only (content in object_versions)"""
    __tablename__ = 'guidelines'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="guidelines")


# ============================================================================
# STORY OBJECTS - NAME/DESCRIPTION ENTITIES
# ============================================================================

class Character(Base):
    """Character entities - structure only (content in object_versions)"""
    __tablename__ = 'characters'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Display order within project (per-type ordering)
    order = Column(Integer, nullable=True, default=0)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="characters")


class Organization(Base):
    """Organization entities - structure only (content in object_versions)"""
    __tablename__ = 'organizations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Display order within project (per-type ordering)
    order = Column(Integer, nullable=True, default=0)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="organizations")


class Location(Base):
    """Location entities - structure only (content in object_versions)"""
    __tablename__ = 'locations'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Display order within project (per-type ordering)
    order = Column(Integer, nullable=True, default=0)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="locations")


class LorebookEntry(Base):
    """Lorebook entries - structure only (content in object_versions)"""
    __tablename__ = 'lorebook_entries'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    # Display order within project (per-type ordering)
    order = Column(Integer, nullable=True, default=0)

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
    """Story outline - structure only (content in object_versions)"""
    __tablename__ = 'outlines'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    order = Column(Integer, nullable=False, default=0)  # Display order within project

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="outlines")
    acts = relationship("Act", back_populates="outline", cascade="all, delete-orphan", order_by="Act.order")


class Act(Base):
    """Acts within an outline - structure only (content in object_versions)"""
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
    """Chapters within an act - structure only (content in object_versions)"""
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
# MANUSCRIPT (Novel Writing - Chapter Content)
# ============================================================================

class Manuscript(Base):
    """Manuscript content for each chapter - structure only (content in object_versions)"""
    __tablename__ = 'manuscripts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chapter_id = Column(UUID(as_uuid=True), ForeignKey('chapters.id', ondelete='CASCADE'), nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    chapter = relationship("Chapter", back_populates="manuscript")
    owned_assets = relationship("Asset", back_populates="manuscript", foreign_keys="Asset.manuscript_id")


# ============================================================================
# AGENT SYSTEM
# ============================================================================

class Agent(Base):
    """Agent conversations per project"""
    __tablename__ = 'agents'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(255), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="agents")
    messages = relationship("AgentMessage", back_populates="agent", cascade="all, delete-orphan", order_by="AgentMessage.created_at")


class AgentMessage(Base):
    """Agent messages with multilingual support and tool calls"""
    __tablename__ = 'agent_messages'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id = Column(UUID(as_uuid=True), ForeignKey('agents.id', ondelete='CASCADE'), nullable=False, index=True)

    role = Column(String(50), nullable=False)

    # Multilingual content stored as JSONB
    # Format: { "English": { "content": "..." }, "Korean": { "content": "..." } }
    data = Column(JSONB, nullable=False)

    # Tool calls metadata (if any) stored as JSONB array
    tool_calls = Column(JSONB)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    agent = relationship("Agent", back_populates="messages")


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

    # Asset type for categorization
    # 'scene': Images from SceneImageGeneratorModal or Rich Editor upload
    # 'object': Story Object images (linked via StoryObjectAsset)
    # null: Uncategorized
    asset_type = Column(String(20), nullable=True, index=True)

    # Manuscript ownership for scene assets (which manuscript this image belongs to)
    manuscript_id = Column(UUID(as_uuid=True), ForeignKey('manuscripts.id', ondelete='CASCADE'), nullable=True, index=True)

    # Generation metadata - prompts stored as StyledPrompt JSON structure
    # StyledPrompt: { "prefix": str, "content": str, "postfix": str }
    # Natural language providers (OpenAI, Gemini, xAI): use generation_prompt only
    # Tag-based providers (NovelAI): use generation_positive_prompt and generation_negative_prompt only
    generation_prompt = Column(JSONB, nullable=True)  # Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt = Column(JSONB, nullable=True)  # Positive prompt for tag-based (NovelAI)
    generation_negative_prompt = Column(JSONB, nullable=True)  # Negative prompt for tag-based (NovelAI)
    generation_provider = Column(String(50), nullable=True)  # 'openai', 'gemini', 'xai', 'novelai'
    generation_model = Column(String(100), nullable=True)
    generation_settings = Column(JSONB, nullable=True)  # Provider-specific settings (sampler, steps, etc.)
    generation_reference_images = Column(JSONB, nullable=True)  # Reference images used during generation (asset_id + strength)
    generation_reference_objects = Column(JSONB, nullable=True)  # Story objects referenced during generation

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
    manuscript = relationship("Manuscript", back_populates="owned_assets", foreign_keys=[manuscript_id])


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
        UniqueConstraint('asset_id', name='uq_story_object_assets_asset_id'),
    )


class ManuscriptImage(Base):
    """Images embedded in manuscript content at specific positions"""
    __tablename__ = 'manuscript_images'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    manuscript_id = Column(UUID(as_uuid=True), ForeignKey('manuscripts.id', ondelete='CASCADE'), nullable=False, index=True)
    language = Column(String(50), nullable=True)  # Language scope (indexed via composite index migration)

    position = Column(Integer, nullable=False)  # Document-order index (0..n-1) within manuscript for a language

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

    __table_args__ = (
        Index("ix_manuscript_images_manuscript_id_language", "manuscript_id", "language"),
        Index("ix_manuscript_images_asset_id", "asset_id"),
    )
