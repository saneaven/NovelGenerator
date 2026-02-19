"""SQLAlchemy database models for Novel Buds"""
from sqlalchemy import Column, String, Integer, BigInteger, DateTime, Boolean, Text, ForeignKey, Index, UniqueConstraint, CheckConstraint, text as sa_text
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
    is_admin = Column(Boolean, default=False, nullable=False)
    asset_quota_bytes = Column(BigInteger, nullable=True)

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
        "agent": {"provider": "openrouter", "model": "gpt-4o-mini", "temperature": 0.7, "max_output_tokens": null, "context_window_tokens": 32000, "advanced": {"enable_prefill": false, "thinking_mode": "off", "thinking_config": {"effort": "medium"}, "request_format": "openai_sdk", "thinking_format": "openai"}},
        "translation": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.2, "max_output_tokens": null, "context_window_tokens": 32000, "advanced": {"enable_prefill": false, "thinking_mode": "off", "thinking_config": {"effort": "medium"}, "request_format": "openai_sdk", "thinking_format": "openai"}},
        "editAssistant": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.7, "max_output_tokens": null, "context_window_tokens": 32000, "advanced": {"enable_prefill": true, "thinking_mode": "off", "thinking_config": {"effort": "medium"}, "request_format": "openai_sdk", "thinking_format": "openai"}},
        "imagePrompt": {"provider": "openrouter", "model": "gpt-4o", "temperature": 0.7, "max_output_tokens": null, "context_window_tokens": 32000, "advanced": {"enable_prefill": false, "thinking_mode": "off", "thinking_config": {"effort": "medium"}, "request_format": "openai_sdk", "thinking_format": "openai"}},
        "summary": {"provider": "openrouter", "model": "gpt-4o-mini", "temperature": 0.2, "max_output_tokens": null, "context_window_tokens": 32000, "advanced": {"enable_prefill": false, "thinking_mode": "off", "thinking_config": {"effort": "medium"}, "request_format": "openai_sdk", "thinking_format": "openai"}},
        "subAgent": {"provider": "openrouter", "model": "gpt-4o-mini", "temperature": 0.7, "max_output_tokens": null, "context_window_tokens": 32000, "advanced": {"enable_prefill": false, "thinking_mode": "off", "thinking_config": {"effort": "medium"}, "request_format": "openai_sdk", "thinking_format": "openai"}}
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

    # Embedding profiles (provider/model/dimensions) by feature.
    # Stored as JSONB to keep settings user-managed and avoid creating per-feature profile tables.
    embedding_configs = Column(JSONB, nullable=False, server_default="""{
        "ragSearch": {"provider": "openai", "model": "", "dimensions": null},
        "agentMemory": {"provider": "openai", "model": "", "dimensions": null}
    }""")

    # RAG Search defaults
    rag_search_top_k_per_query = Column(Integer, default=20, nullable=False)
    rag_search_neighbor_window = Column(Integer, default=0, nullable=False)
    rag_search_max_primary_chunks = Column(Integer, default=20, nullable=False)
    rag_search_max_total_chunks = Column(Integer, default=60, nullable=False)
    rag_search_keyword_page_size = Column(Integer, default=20, nullable=False)

    # Agent Memory search defaults (relevantChats RAG)
    agent_memory_top_k_per_query = Column(Integer, default=20, nullable=False)
    agent_memory_neighbor_window = Column(Integer, default=0, nullable=False)
    agent_memory_max_primary_messages = Column(Integer, default=20, nullable=False)
    agent_memory_max_total_messages = Column(Integer, default=60, nullable=False)

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
            "subAgent": False,
        },
    )

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
# SERVER CREDENTIALS (SERVER-SIDE ENCRYPTED)
# ============================================================================

class ServerCredential(Base):
    """Server-side encrypted provider credentials per user/provider."""
    __tablename__ = "server_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(50), nullable=False)
    encrypted_config = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_server_credentials_user_provider"),
    )

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
    sub_agents = relationship("SubAgentDefinitionModel", back_populates="preset", cascade="all, delete-orphan")

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
# SUB AGENTS (PER PRESET)
# ============================================================================

class SubAgentDefinitionModel(Base):
    """Sub Agent definition stored per prompt preset."""
    __tablename__ = "sub_agent_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey("prompt_presets.id", ondelete="CASCADE"), nullable=False, index=True)

    # Stable key used as PromptVersion.prompt_name (agent_name). Also the suffix for call_{agent_name}.
    agent_name = Column(String(50), nullable=False)

    display_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)

    # Stored as JSON arrays
    allowed_invocation_modes = Column(JSONB, nullable=False)
    # Static tool names only (create_*/read_*/patch_*/replace_* etc). Never store call_* here.
    allowed_tool_names = Column(JSONB, nullable=False)
    # UUID list of sub_agent_definitions.id that this Sub Agent is allowed to call.
    allowed_sub_agent_ids = Column(JSONB, nullable=False)

    # If true, use llm_config_override for this Sub Agent; otherwise inherit the global config.
    use_custom_llm_config = Column(Boolean, default=False, nullable=False)

    # TaskAIConfig-like payload (provider/model/temp/thinking settings etc.) used when use_custom_llm_config=true.
    llm_config_override = Column(JSONB, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="sub_agents")

    __table_args__ = (
        UniqueConstraint("preset_id", "agent_name", name="uq_sub_agent_per_preset"),
        Index("idx_sub_agent_preset", "preset_id"),
    )


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
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
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
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
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

    # Long-term memory boundary cache (UI divider + idempotency for archive)
    archived_until_message_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="agents")


# ============================================================================
# THREAD (UNIFIED CONVERSATION CONTAINER)
# ============================================================================

class Thread(Base):
    """Unified conversation container for agent/subAgent/journey.

    Each agent auto-creates one thread.  SubAgent and journey threads are
    created on demand.  The pipeline treats all three identically.
    """
    __tablename__ = 'threads'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)

    thread_type = Column(String(20), nullable=False)  # 'agent' | 'subAgent' | 'journey'
    # Polymorphic owner: agent.id for agent threads, sub_agent_definitions.id for subAgent, NULL for journey
    owner_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    journey_kind = Column(String(40), nullable=True)  # for journey threads only

    status = Column(String(20), nullable=False, default='done')

    # Rendered conversation snapshot — re-captured on every create, reused on resume.
    captured_history_system_prompt = Column(Text, nullable=True)
    captured_history_conversation_json = Column(JSONB, nullable=True)
    captured_history_prefill = Column(Text, nullable=True)

    # Stable per-thread run ordering (1-based)
    next_run_seq = Column(BigInteger, default=1, nullable=False)
    # Stable per-thread message ordering (1-based)
    next_message_seq = Column(BigInteger, default=1, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project")
    user = relationship("User")
    runs = relationship("RunModel", back_populates="thread", cascade="all, delete-orphan", order_by="RunModel.run_seq")

    __table_args__ = (
        CheckConstraint(
            "thread_type IN ('agent','subAgent','journey')",
            name='ck_threads_type',
        ),
        CheckConstraint(
            "status IN ('running','waiting','processing','paused','done','error','canceled')",
            name='ck_threads_status',
        ),
        Index('ix_threads_project_type', 'project_id', 'thread_type'),
        Index('ix_threads_owner', 'owner_id'),
    )


# ============================================================================
# RUN RUNTIME (UNIFIED AGENT/SUBAGENT/JOURNEY RUNS)
# ============================================================================

class RunModel(Base):
    """Unified run state for agent/subAgent/journey.

    Type-specific metadata (agent_id, sub_agent_id, journey_kind) lives on
    the parent Thread.  RunModel only stores per-run fields.
    """
    __tablename__ = 'runs'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey('threads.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)

    status = Column(String(20), nullable=False)
    run_seq = Column(BigInteger, nullable=True)  # Ordering within thread

    language = Column(String(50), nullable=False)
    error = Column(Text, nullable=True)

    # Agent-only metadata (per-run, can differ between runs in same thread)
    run_mode = Column(String(20), nullable=True)
    surface = Column(String(40), nullable=True)
    context_object_ids = Column(JSONB, nullable=False, default=list)

    # Journey-only metadata (per-run targets)
    journey_target_ids = Column(JSONB, nullable=False, default=list)

    # Sub-agent metadata (which parent tool call spawned this run)
    parent_run_id = Column(UUID(as_uuid=True), ForeignKey('runs.id', ondelete='CASCADE'), nullable=True, index=True)
    parent_run_message_id = Column(UUID(as_uuid=True), nullable=True)
    parent_run_tool_call_id = Column(String(255), nullable=True)

    # Resolved once during _assemble_create, read by _run_llm.
    resolved_output_mode = Column(String(20), nullable=False, server_default="tool_call")
    resolved_toolset = Column(String(40), nullable=False, server_default="agent_agent_mode")

    next_message_seq = Column(BigInteger, default=1, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    thread = relationship("Thread", back_populates="runs")
    project = relationship("Project")
    parent_run = relationship("RunModel", remote_side=[id], backref="child_runs")
    messages = relationship(
        "RunMessageModel",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RunMessageModel.seq",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('running','waiting','processing','paused','done','error','canceled')",
            name='ck_runs_status',
        ),
        Index('ix_runs_thread_status', 'thread_id', 'status'),
        Index('ix_runs_project_status', 'project_id', 'status'),
        Index('ix_runs_parent', 'parent_run_id'),
        Index(
            'uq_runs_thread_seq',
            'thread_id',
            'run_seq',
            unique=True,
            postgresql_where=sa_text("run_seq IS NOT NULL"),
        ),
        Index(
            'uq_runs_child_parent_tool',
            'parent_run_id',
            'parent_run_message_id',
            'parent_run_tool_call_id',
            unique=True,
            postgresql_where=sa_text("parent_run_id IS NOT NULL"),
        ),
    )


class RunMessageModel(Base):
    """Message history for unified runs."""
    __tablename__ = 'run_messages'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey('threads.id', ondelete='CASCADE'), nullable=False, index=True)
    run_id = Column(UUID(as_uuid=True), ForeignKey('runs.id', ondelete='CASCADE'), nullable=False, index=True)
    seq = Column(BigInteger, nullable=False)  # per-run sequence
    seq_in_thread = Column(BigInteger, nullable=True)  # cross-run ordering within thread
    role = Column(String(16), nullable=False)
    # Multilingual content: { "English": { "contentParts": [...], "thinkingDetails": [...] }, ... }
    data = Column(JSONB, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Parent tool call that owns this message (role='tool_call').
    # Cascade: deleting the tool call deletes its child messages.
    parent_tool_call_id = Column(
        UUID(as_uuid=True),
        ForeignKey('run_tool_calls.id', ondelete='CASCADE'),
        nullable=True,
        index=True,
    )

    thread = relationship("Thread")
    run = relationship("RunModel", back_populates="messages")
    tool_calls = relationship(
        "RunToolCallModel",
        back_populates="message",
        cascade="save-update, merge",
        passive_deletes=True,
        order_by="RunToolCallModel.call_seq",
        foreign_keys="RunToolCallModel.message_id",
    )

    __table_args__ = (
        CheckConstraint("role IN ('system','user','assistant','tool_call')", name='ck_run_messages_role'),
        UniqueConstraint('run_id', 'seq', name='uq_run_messages_run_seq'),
        Index('ix_run_messages_run_created', 'run_id', 'created_at'),
        Index('ix_run_messages_thread_seq', 'thread_id', 'seq_in_thread'),
    )


class RunToolCallModel(Base):
    """Tool calls emitted by a run assistant message."""
    __tablename__ = 'run_tool_calls'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey('threads.id', ondelete='CASCADE'), nullable=False, index=True)
    run_id = Column(UUID(as_uuid=True), ForeignKey('runs.id', ondelete='CASCADE'), nullable=False, index=True)
    # Denormalized pointer to the dedicated role='tool_call' message row.
    message_id = Column(UUID(as_uuid=True), ForeignKey('run_messages.id', ondelete='SET NULL'), nullable=True, index=True)
    # Assistant message that originated this tool call.
    # Cascade: deleting the assistant message deletes its tool calls.
    assistant_message_id = Column(UUID(as_uuid=True), ForeignKey('run_messages.id', ondelete='CASCADE'), nullable=True, index=True)
    call_seq = Column(Integer, nullable=False)
    llm_call_id = Column(String(255), nullable=False)
    tool_name = Column(String(120), nullable=False)
    arguments = Column(JSONB, nullable=False, default=dict)
    status = Column(String(20), nullable=False)
    reason = Column(Text, nullable=True)
    result = Column(JSONB, nullable=True)
    # For call_sub_agent: tracks the child run/thread spawned by this tool call
    child_run_id = Column(UUID(as_uuid=True), ForeignKey('runs.id', ondelete='SET NULL'), nullable=True)
    child_thread_id = Column(UUID(as_uuid=True), ForeignKey('threads.id', ondelete='SET NULL'), nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    thread = relationship("Thread", foreign_keys=[thread_id])
    message = relationship("RunMessageModel", back_populates="tool_calls", foreign_keys=[message_id], passive_deletes=True)
    child_messages = relationship(
        "RunMessageModel",
        foreign_keys="RunMessageModel.parent_tool_call_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    child_run = relationship("RunModel", foreign_keys=[child_run_id])
    child_thread = relationship("Thread", foreign_keys=[child_thread_id])

    __table_args__ = (
        CheckConstraint(
            "status IN ('streaming','validating','pending','processing','failed','rejected','applied')",
            name='ck_run_tool_calls_status',
        ),
        UniqueConstraint('message_id', 'llm_call_id', name='uq_run_tool_calls_message_llm_call_id'),
        UniqueConstraint('message_id', 'call_seq', name='uq_run_tool_calls_message_call_seq'),
        Index('ix_run_tool_calls_message', 'message_id'),
        Index('ix_run_tool_calls_thread_status', 'thread_id', 'status'),
        Index('ix_run_tool_calls_assistant_message', 'assistant_message_id'),
        Index('ix_run_tool_calls_name', 'tool_name'),
    )


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
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id', ondelete='CASCADE'), nullable=True)

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
