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
from utils.timeline_calendar import DEFAULT_CALENDAR_JSON


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
    storage_quota_bytes = Column(BigInteger, nullable=True)

    # Relationships
    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")
    project_storage_usages = relationship("ProjectStorageUsage", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("UserSettings", back_populates="user", uselist=False, cascade="all, delete-orphan")


# ============================================================================
# USER SETTINGS
# ============================================================================

class UserSettings(Base):
    """User preferences and settings"""
    __tablename__ = 'user_settings'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)

    # General task config plus per-task overrides.
    task_config_settings = Column(JSONB, nullable=False)

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
        "model": "gpt-image-2",
        "aspect_ratio": "1:1",
        "image_size": "1K",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": null,
        "selectedTagBasedStyleId": null,
        "providerSettings": {
            "openai": {"quality": "medium", "background": "auto", "output_format": "png", "output_compression": 90, "moderation": "auto"},
            "novelai": {
                "sampler": "k_euler_ancestral",
                "steps": 28,
                "scale": 6.0,
                "noise_schedule": "karras",
                "referenceMode": "auto",
                "strength": 0.7,
                "i2iNoise": 0.0,
                "vibeStrength": 0.6,
                "vibeInfoExtracted": 1.0
            },
            "gemini": {},
            "xai": {},
            "openrouter": {},
            "nanogpt": {}
        }
    }""")

    # Native output mode - use raw LLM output instead of tool calling
    native_output_mode = Column(Boolean, default=False, nullable=False)

    # Search & Memory settings (master toggle + general config + Search/Memory overrides).
    search_memory_settings = Column(JSONB, nullable=False, server_default="""{
        "enabled": false,
        "general": {
            "embedding": {"provider": "openai", "model": "", "dimensions": null},
            "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
            "regexPageSize": 20
        },
        "overrides": {}
    }""")

    # LLM prompt cache settings (global per-provider cache preferences).
    llm_cache_settings = Column(JSONB, nullable=False, server_default="""{
        "openai": {"enabled": true, "retention": "default"},
        "claude": {"enabled": true, "ttl": "5m"},
        "gemini": {"enabled": true, "implicit": true, "explicit": true, "explicit_ttl_preset": "1h"},
        "xai": {"enabled": true},
        "nanogpt": {"enabled": true, "ttl": "5m", "stickyProvider": false}
    }""")

    # Patch auto-retry - automatically retry with replace mode if patch fails
    patch_auto_retry = Column(Boolean, default=True, nullable=False)

    # LLM logging enabled - enable LLM request logging for debugging
    llm_logging_enabled = Column(Boolean, default=False, nullable=False)

    # Tool call history limit - number of previous completed runs to include tool calls for
    tool_call_history_limit = Column(Integer, default=5, nullable=False)

    # Thinking history limit - number of previous completed runs to include reasoning/thinking for
    thinking_history_limit = Column(Integer, default=5, nullable=False)

    # Tool call auto-approve settings (all-or-none per assistant response)
    tool_call_auto_approve = Column(
        JSONB,
        nullable=False,
        default=dict,
    )

    # Custom thinking templates for custom provider openai_completion mode.
    custom_thinking_templates = Column(JSONB, nullable=False, server_default='[]')

    # UI Language for interface localization (i18next)
    ui_language = Column(String(10), default='en', nullable=False)

    # Demo mode toggle for first-run experience
    demo_mode_enabled = Column(Boolean, default=False, nullable=False)

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
    scenarios = relationship("PromptScenarioVersion", back_populates="preset", cascade="all, delete-orphan")
    folders = relationship("PromptFolder", back_populates="preset", cascade="all, delete-orphan")
    fragments = relationship("PromptFragment", back_populates="preset", cascade="all, delete-orphan")
    variables = relationship("PromptVariable", back_populates="preset", cascade="all, delete-orphan")
    sub_agents = relationship("SubAgentDefinitionModel", back_populates="preset", cascade="all, delete-orphan")
    mcp_servers = relationship("McpServerModel", back_populates="preset", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('user_id', 'name', name='uq_preset_user_name'),
        Index('idx_preset_user', 'user_id'),
    )


# ============================================================================
# PROMPT SCENARIO VERSIONS
# ============================================================================

class PromptScenarioVersion(Base):
    """Version-controlled scenario documents (system_template + blocks)."""
    __tablename__ = "prompt_scenario_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey('prompt_presets.id', ondelete='CASCADE'), nullable=False, index=True)

    # Scenario identification (hierarchy: task_type → task_subtype)
    task_type = Column(String(50), nullable=False)  # 'agent', 'translation', 'editAssistant', 'imagePrompt'
    task_subtype = Column(String(50), nullable=False)  # 'planMode', 'agentMode', 'object', 'manuscript', etc.

    # Version data
    scenario = Column(JSONB, nullable=False)
    version_number = Column(Integer, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    note = Column(Text)

    # Relationships
    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="scenarios")

    __table_args__ = (
        UniqueConstraint("preset_id", "task_type", "task_subtype", "version_number", name="uq_scenario_preset_task_version"),
        Index("idx_scenario_preset_task", "preset_id", "task_type", "task_subtype", "version_number"),
    )


# ============================================================================
# SUB AGENTS (PER PRESET)
# ============================================================================

class SubAgentDefinitionModel(Base):
    """Sub Agent definition stored per prompt preset."""
    __tablename__ = "sub_agent_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey("prompt_presets.id", ondelete="CASCADE"), nullable=False, index=True)

    # Stable key used as PromptScenarioVersion.task_subtype (agent_name). Also the suffix for call_{agent_name}.
    agent_name = Column(String(50), nullable=False)

    display_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)

    # Stored as JSON arrays
    allowed_invocation_modes = Column(JSONB, nullable=False)
    # Feature/category grants for this sub-agent.
    tool_grants = Column(JSONB, nullable=False, default=list)
    # UUID list of sub_agent_definitions.id that this Sub Agent is allowed to call.
    allowed_sub_agent_ids = Column(JSONB, nullable=False)
    # UUID list of mcp_servers.id that this Sub Agent is allowed to use.
    allowed_mcp_server_ids = Column(JSONB, nullable=False, default=list)

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
# MCP SERVERS (PER PRESET)
# ============================================================================

class McpServerModel(Base):
    """MCP server definition stored per prompt preset."""
    __tablename__ = "mcp_servers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey("prompt_presets.id", ondelete="CASCADE"), nullable=False, index=True)

    server_key = Column(String(64), nullable=False)
    display_name = Column(String(200), nullable=False)
    server_url = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    allow_agent_mode = Column(Boolean, default=True, nullable=False)
    allow_plan_mode = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="mcp_servers")
    secret = relationship(
        "McpServerSecretModel",
        back_populates="server",
        cascade="all, delete-orphan",
        uselist=False,
    )
    snapshot = relationship(
        "McpServerSnapshotModel",
        back_populates="server",
        cascade="all, delete-orphan",
        uselist=False,
    )

    __table_args__ = (
        UniqueConstraint("preset_id", "server_key", name="uq_mcp_server_preset_key"),
        Index("idx_mcp_servers_preset", "preset_id"),
    )


class McpServerSecretModel(Base):
    """Encrypted auth payload for an MCP server."""
    __tablename__ = "mcp_server_secrets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id = Column(UUID(as_uuid=True), ForeignKey("mcp_servers.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    auth_kind = Column(String(20), nullable=False)
    encrypted_payload = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    server = relationship("McpServerModel", back_populates="secret")


class McpServerSnapshotModel(Base):
    """Latest synced MCP capability snapshot."""
    __tablename__ = "mcp_server_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id = Column(UUID(as_uuid=True), ForeignKey("mcp_servers.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    protocol_version = Column(String(32), nullable=True)
    server_info_json = Column(JSONB, nullable=False, default=dict)
    capabilities_raw_json = Column(JSONB, nullable=False, default=dict)
    catalog_json = Column(JSONB, nullable=False, default=dict)
    sync_error = Column(Text, nullable=True)
    synced_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    server = relationship("McpServerModel", back_populates="snapshot")


# ============================================================================
# PROMPT FOLDERS
# ============================================================================

class PromptFolder(Base):
    """Folder entity for organizing prompt fragments hierarchically"""
    __tablename__ = 'prompt_folders'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    preset_id = Column(UUID(as_uuid=True), ForeignKey('prompt_presets.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(100), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey('prompt_folders.id', ondelete='CASCADE'), nullable=True, index=True)
    display_order = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="folders")
    parent = relationship("PromptFolder", remote_side=[id], backref="children")
    fragments = relationship("PromptFragment", back_populates="folder")

    __table_args__ = (
        UniqueConstraint('preset_id', 'parent_id', 'name', name='uq_folder_preset_parent_name'),
        Index('idx_folder_preset_parent', 'preset_id', 'parent_id'),
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
    folder_id = Column(UUID(as_uuid=True), ForeignKey('prompt_folders.id', ondelete='CASCADE'), nullable=True, index=True)
    fragment_name = Column(String(100), nullable=False)

    # Content
    content = Column(Text, nullable=False)
    description = Column(Text, nullable=True)

    # Version control (same pattern as PromptScenarioVersion)
    version_number = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User")
    preset = relationship("PromptPreset", back_populates="fragments")
    folder = relationship("PromptFolder", back_populates="fragments")


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
    storage_usage = relationship("ProjectStorageUsage", back_populates="project", uselist=False, cascade="all, delete-orphan")
    basic_info = relationship("BasicInfo", back_populates="project", uselist=False, cascade="all, delete-orphan")
    guidelines = relationship("Guidelines", back_populates="project", uselist=False, cascade="all, delete-orphan")
    timeline = relationship("Timeline", back_populates="project", uselist=False, cascade="all, delete-orphan")
    story_entity_folders = relationship("StoryEntityFolder", back_populates="project", cascade="all, delete-orphan", order_by="StoryEntityFolder.display_order")
    story_entities = relationship("StoryEntity", back_populates="project", cascade="all, delete-orphan", order_by="StoryEntity.display_order")
    outlines = relationship("Outline", back_populates="project", cascade="all, delete-orphan", order_by="Outline.position")
    agents = relationship("Agent", back_populates="project", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="project", cascade="all, delete-orphan")


class ProjectStorageUsage(Base):
    """Precomputed per-project logical storage totals."""
    __tablename__ = "project_storage_usage"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    project_meta_bytes = Column(BigInteger, nullable=False, default=0)
    story_bytes = Column(BigInteger, nullable=False, default=0)
    manuscript_bytes = Column(BigInteger, nullable=False, default=0)
    chat_bytes = Column(BigInteger, nullable=False, default=0)
    notification_bytes = Column(BigInteger, nullable=False, default=0)
    image_run_bytes = Column(BigInteger, nullable=False, default=0)
    image_bytes = Column(BigInteger, nullable=False, default=0)
    llm_log_bytes = Column(BigInteger, nullable=False, default=0)
    total_bytes = Column(BigInteger, nullable=False, default=0)
    needs_reconcile = Column(Boolean, nullable=False, default=False, server_default=sa_text("false"))
    last_reconciled_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="storage_usage")
    user = relationship("User", back_populates="project_storage_usages")

    __table_args__ = (
        Index("ix_project_storage_usage_needs_reconcile", "needs_reconcile"),
        Index("ix_project_storage_usage_last_reconciled_at", "last_reconciled_at"),
    )


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
# STORY ENTITIES
# ============================================================================

class StoryEntityFolder(Base):
    """Project-scoped folder tree for story entities."""
    __tablename__ = "story_entity_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("story_entity_folders.id", ondelete="CASCADE"), nullable=True, index=True)
    display_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="story_entity_folders")
    parent = relationship("StoryEntityFolder", remote_side=[id], back_populates="children")
    children = relationship(
        "StoryEntityFolder",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="StoryEntityFolder.display_order",
    )
    story_entities = relationship("StoryEntity", back_populates="folder")

    __table_args__ = (
        Index("ix_story_entity_folders_project_parent_order", "project_id", "parent_id", "display_order"),
    )


class StoryEntity(Base):
    """Folderable mixed-kind story entity structure."""
    __tablename__ = "story_entities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(50), nullable=False, index=True)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("story_entity_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    display_order = Column(Integer, nullable=False, default=0)

    # Image prompt fields (stored on base object, not versioned)
    image_prompt = Column(Text, nullable=True)  # Natural language prompt
    image_prompt_positive = Column(Text, nullable=True)  # NovelAI positive tags
    image_prompt_negative = Column(Text, nullable=True)  # NovelAI negative tags

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="story_entities")
    folder = relationship("StoryEntityFolder", back_populates="story_entities")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('character', 'organization', 'location', 'lorebook')",
            name="ck_story_entities_kind",
        ),
        Index("ix_story_entities_project_kind", "project_id", "kind"),
        Index("ix_story_entities_project_folder_order", "project_id", "folder_id", "display_order"),
    )


# ============================================================================
# OUTLINE STRUCTURE
# ============================================================================

class Outline(Base):
    """Story structure node - root outlines, acts, and chapters."""
    __tablename__ = 'outlines'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    kind = Column(String(20), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey('outlines.id', ondelete='CASCADE'), nullable=True, index=True)
    position = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="outlines")
    parent = relationship("Outline", remote_side=[id], back_populates="children", foreign_keys=[parent_id])
    children = relationship("Outline", back_populates="parent", cascade="all, delete-orphan", order_by="Outline.position")
    manuscript = relationship("Manuscript", back_populates="chapter", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('outline', 'act', 'chapter')",
            name="ck_outlines_kind",
        ),
        CheckConstraint(
            "position >= 0",
            name="ck_outlines_position_non_negative",
        ),
        Index("ix_outlines_project_parent_position", "project_id", "parent_id", "position"),
        Index("ix_outlines_project_kind", "project_id", "kind"),
    )


# ============================================================================
# MANUSCRIPT (Novel Writing - Chapter Content)
# ============================================================================

class Manuscript(Base):
    """Manuscript content for each chapter - structure only (content in object_versions)"""
    __tablename__ = 'manuscripts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chapter_id = Column(UUID(as_uuid=True), ForeignKey('outlines.id', ondelete='CASCADE'), nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    chapter = relationship("Outline", back_populates="manuscript")
    owned_assets = relationship("Asset", back_populates="manuscript", foreign_keys="Asset.manuscript_id")


# ============================================================================
# TIMELINE
# ============================================================================

class Timeline(Base):
    """Per-project timeline configuration and track container."""
    __tablename__ = "timelines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    calendar = Column(
        JSONB,
        nullable=False,
        server_default=sa_text(f"'{DEFAULT_CALENDAR_JSON}'::jsonb"),
    )

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="timeline")
    tracks = relationship(
        "TimelineTrack",
        back_populates="timeline",
        cascade="all, delete-orphan",
        order_by="TimelineTrack.position",
    )


class TimelineTrack(Base):
    """Timeline track tree used to group events."""
    __tablename__ = "timeline_tracks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    timeline_id = Column(UUID(as_uuid=True), ForeignKey("timelines.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("timeline_tracks.id", ondelete="CASCADE"), nullable=True, index=True)
    position = Column(Integer, nullable=False, default=0)
    color = Column(String(20), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    timeline = relationship("Timeline", back_populates="tracks")
    parent = relationship("TimelineTrack", remote_side=[id], back_populates="children")
    children = relationship(
        "TimelineTrack",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="TimelineTrack.position",
    )
    events = relationship(
        "TimelineEvent",
        back_populates="track",
        cascade="all, delete-orphan",
        order_by="TimelineEvent.created_at",
    )

    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_timeline_tracks_position_non_negative"),
        Index("ix_timeline_tracks_timeline_parent_position", "timeline_id", "parent_id", "position"),
    )


class TimelineEvent(Base):
    """Timeline event with optional range and free-form tags."""
    __tablename__ = "timeline_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    track_id = Column(UUID(as_uuid=True), ForeignKey("timeline_tracks.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(JSONB, nullable=False)
    end_date = Column(JSONB, nullable=True)
    tags = Column(JSONB, nullable=False, server_default=sa_text("'[]'::jsonb"))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    track = relationship("TimelineTrack", back_populates="events")
    links = relationship("TimelineEventLink", back_populates="event", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_timeline_events_track_id", "track_id"),
    )


class TimelineEventLink(Base):
    """Polymorphic object link attached to a timeline event."""
    __tablename__ = "timeline_event_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("timeline_events.id", ondelete="CASCADE"), nullable=False)
    object_type = Column(String(50), nullable=False)
    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    event = relationship("TimelineEvent", back_populates="links")

    __table_args__ = (
        UniqueConstraint("event_id", "object_type", "object_id", name="uq_timeline_event_link_target"),
        Index("ix_timeline_event_links_event_id", "event_id"),
        Index("ix_timeline_event_links_object_target", "object_type", "object_id"),
    )


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
# JOURNEY (USER-SCOPED WORK UNIT)
# ============================================================================

class Journey(Base):
    """User-scoped background work unit whose runtime is stored in a child thread."""
    __tablename__ = "journeys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    kind = Column(String(40), nullable=False)
    display_label = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False, default="running")
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project")
    user = relationship("User")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('manuscriptEdit','outlineEdit','objectEdit','objectTranslation','imagePrompt','sceneImagePrompt','messageTranslation')",
            name="ck_journeys_kind",
        ),
        CheckConstraint(
            "status IN ('running','waiting','processing','ready','paused','done','error','canceled')",
            name="ck_journeys_status",
        ),
        Index("ix_journeys_project_status", "project_id", "status"),
        Index("ix_journeys_user_project_updated", "user_id", "project_id", "updated_at"),
    )


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
    # Polymorphic parent: agents.id | sub_agent_definitions.id | journeys.id
    parent_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    status = Column(String(20), nullable=False, default='done')

    # Scenario-block prompt snapshot — re-captured on create, extended on resume.
    captured_prompt_snapshot = Column(JSONB, nullable=True)

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
    prompt_caches = relationship("ThreadPromptCache", back_populates="thread", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "thread_type IN ('agent','subAgent','journey')",
            name='ck_threads_type',
        ),
        CheckConstraint(
            "status IN ('running','waiting','processing','ready','paused','done','error','canceled')",
            name='ck_threads_status',
        ),
        Index('ix_threads_project_type', 'project_id', 'thread_type'),
        Index('ix_threads_parent', 'parent_id'),
        Index(
            "uq_threads_agent_parent",
            "parent_id",
            unique=True,
            postgresql_where=sa_text("thread_type = 'agent'"),
        ),
        Index(
            "uq_threads_journey_parent",
            "parent_id",
            unique=True,
            postgresql_where=sa_text("thread_type = 'journey'"),
        ),
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

    # Payload sent with the initial user message (journey params, edit targets, etc.)
    input_payload = Column(JSONB, nullable=False, default=dict)
    mcp_request_json = Column(JSONB, nullable=False, default=lambda: {"selections": []})
    mcp_resolution_json = Column(
        JSONB,
        nullable=False,
        default=lambda: {
            "system_overlays": [],
            "injected_messages": [],
            "user_message_parts": [],
            "template_contexts": [],
            "tool_server_ids": [],
            "audit": [],
        },
    )

    # Sub-agent metadata (which parent tool call spawned this run)
    parent_run_id = Column(UUID(as_uuid=True), ForeignKey('runs.id', ondelete='CASCADE'), nullable=True, index=True)
    parent_run_message_id = Column(UUID(as_uuid=True), nullable=True)
    parent_run_tool_call_id = Column(String(255), nullable=True)

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
            "status IN ('running','waiting','processing','ready','paused','done','error','canceled')",
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
    # Multilingual content: { "English": { "contentParts": [...], "reasoningDetail": {...} }, ... }
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
    attachments = relationship(
        "RunMessageAttachmentModel",
        back_populates="message",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RunMessageAttachmentModel.sort_order",
    )

    __table_args__ = (
        CheckConstraint("role IN ('system','user','assistant','tool_call')", name='ck_run_messages_role'),
        UniqueConstraint('run_id', 'seq', name='uq_run_messages_run_seq'),
        Index('ix_run_messages_run_created', 'run_id', 'created_at'),
        Index('ix_run_messages_thread_seq', 'thread_id', 'seq_in_thread'),
    )


class RunMessageAttachmentModel(Base):
    """Attachments stored alongside a run message."""
    __tablename__ = "run_message_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id = Column(UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(UUID(as_uuid=True), ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order = Column(Integer, nullable=False)
    kind = Column(String(20), nullable=False)
    mime_type = Column(String(120), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    storage_key = Column(String(512), nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    project = relationship("Project")
    thread = relationship("Thread")
    run = relationship("RunModel")
    message = relationship("RunMessageModel", back_populates="attachments")

    __table_args__ = (
        CheckConstraint("kind IN ('image','document','text_file')", name="ck_run_message_attachments_kind"),
        UniqueConstraint("message_id", "sort_order", name="uq_run_message_attachments_message_sort"),
        Index("ix_run_message_attachments_thread_created", "thread_id", "created_at"),
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
    extra_content = Column(JSONB, nullable=True)
    status = Column(String(20), nullable=False)
    reason = Column(Text, nullable=True)
    result = Column(JSONB, nullable=True)
    image_run_id = Column(UUID(as_uuid=True), ForeignKey('image_runs.id', ondelete='SET NULL'), nullable=True, index=True)
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
            "status IN ('streaming','validating','pending','processing','working','failed','rejected','applied')",
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
# IMAGE RUNS
# ============================================================================

class ImageRunModel(Base):
    """Server-managed image generation lifecycle shared by direct and tool flows."""
    __tablename__ = 'image_runs'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    thread_id = Column(UUID(as_uuid=True), ForeignKey('threads.id', ondelete='CASCADE'), nullable=True, index=True)

    client_request_id = Column(String(128), nullable=True, index=True)
    origin = Column(String(20), nullable=False)
    review_mode = Column(String(16), nullable=False)
    status = Column(String(20), nullable=False)
    stage = Column(String(20), nullable=True)

    request_snapshot = Column(JSONB, nullable=False, default=dict)

    preview_asset_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    final_asset_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    provider = Column(String(50), nullable=True)
    model = Column(String(100), nullable=True)
    resolved_aspect_ratio = Column(String(32), nullable=True)
    resolved_image_size = Column(String(32), nullable=True)
    resolved_native_size = Column(String(32), nullable=True)
    revised_prompt = Column(Text, nullable=True)

    before_excerpt = Column(Text, nullable=True)
    after_excerpt = Column(Text, nullable=True)

    failure_code = Column(String(120), nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    thread = relationship("Thread", foreign_keys=[thread_id])
    project = relationship("Project")
    user = relationship("User")

    __table_args__ = (
        CheckConstraint(
            "origin IN ('direct','tool_preview')",
            name='ck_image_runs_origin',
        ),
        CheckConstraint(
            "review_mode IN ('auto','manual')",
            name='ck_image_runs_review_mode',
        ),
        CheckConstraint(
            "status IN ('queued','running','review','applying','applied','rejected','failed','canceled')",
            name='ck_image_runs_status',
        ),
        CheckConstraint(
            "stage IS NULL OR stage IN ('preparing','generating','saving','binding')",
            name='ck_image_runs_stage',
        ),
        Index('ix_image_runs_project_status', 'project_id', 'status'),
        Index('ix_image_runs_thread_created', 'thread_id', 'created_at'),
    )


# ============================================================================
# NOTIFICATIONS
# ============================================================================

class NotificationModel(Base):
    """User-scoped notifications (single source of truth)."""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)

    source_kind = Column(String(32), nullable=False)  # 'journey' | 'imageRun' | 'system'
    source_id = Column(String(160), nullable=False)

    status = Column(String(16), nullable=False)  # Source-specific raw status (journey|imageRun|system)
    label = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    warning = Column(Text, nullable=True)

    progress_json = Column(JSONB, nullable=True)
    custom_slot_json = Column(JSONB, nullable=True)
    target_json = Column(JSONB, nullable=True)
    meta_json = Column(JSONB, nullable=True)
    important = Column(Boolean, default=False, nullable=False)

    is_read = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("source_kind IN ('journey','imageRun','system','agent','subAgent')", name="ck_notifications_source_kind"),
        CheckConstraint(
            "status IN ("
            "'running','waiting','processing','ready','paused','done','error','canceled',"
            "'queued','review','applying','applied','rejected','failed'"
            ")",
            name="ck_notifications_status",
        ),
        UniqueConstraint("user_id", "source_kind", "source_id", name="uq_notifications_user_source"),
        Index("ix_notifications_user_order", "user_id", "important", "is_read", "updated_at", "id"),
        Index("ix_notifications_user_project", "user_id", "project_id", "updated_at", "id"),
        Index("ix_notifications_source", "source_kind", "source_id"),
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
    # 'object': Story Object images (linked via ObjectAssetLink)
    # null: Uncategorized
    asset_type = Column(String(20), nullable=True, index=True)

    # Manuscript ownership for scene assets (which manuscript this image belongs to)
    manuscript_id = Column(UUID(as_uuid=True), ForeignKey('manuscripts.id', ondelete='CASCADE'), nullable=True, index=True)
    # Tool-call owned preview assets remain hidden until explicitly applied.
    preview_image_run_id = Column(UUID(as_uuid=True), ForeignKey('image_runs.id', ondelete='SET NULL'), nullable=True, index=True)

    # Generation metadata - prompts stored as StyledPrompt JSON structure
    # StyledPrompt: { "prefix": str, "content": str, "postfix": str }
    # Natural language providers (OpenAI, Gemini, xAI): use generation_prompt only
    # Tag-based providers (NovelAI): use generation_positive_prompt and generation_negative_prompt only
    generation_prompt = Column(JSONB, nullable=True)  # Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt = Column(JSONB, nullable=True)  # Positive prompt for tag-based (NovelAI)
    generation_negative_prompt = Column(JSONB, nullable=True)  # Negative prompt for tag-based (NovelAI)
    generation_provider = Column(String(50), nullable=True)  # 'openai', 'gemini', 'xai', 'novelai'
    generation_model = Column(String(100), nullable=True)
    generation_style_id = Column(String(255), nullable=True)
    generation_requested_aspect_ratio = Column(String(32), nullable=True)
    generation_requested_image_size = Column(String(32), nullable=True)
    generation_settings = Column(JSONB, nullable=True)  # Provider-specific settings (sampler, steps, etc.)
    generation_reference_images = Column(JSONB, nullable=True)  # Reference images used during generation (asset_id + strength)
    generation_mask_image = Column(JSONB, nullable=True)  # Mask image used during generation (asset_id)
    generation_reference_objects = Column(JSONB, nullable=True)  # Project objects referenced during generation

    # Image dimensions
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    file_size = Column(Integer, nullable=True)  # In bytes

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="assets")
    object_asset_links = relationship("ObjectAssetLink", back_populates="asset", cascade="all, delete-orphan")
    rich_text_image_refs = relationship("RichTextImageRef", back_populates="asset", cascade="all, delete-orphan")
    manuscript = relationship("Manuscript", back_populates="owned_assets", foreign_keys=[manuscript_id])


class ObjectAssetLink(Base):
    """Links assets to project objects such as story entities and basic info."""
    __tablename__ = 'object_asset_links'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Polymorphic reference to a canonical object target.
    object_type = Column(String(50), nullable=False)  # 'story_entity', 'basic_info'
    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id', ondelete='CASCADE'), nullable=False, index=True)

    is_main = Column(Boolean, default=False, nullable=False)  # Main image shown in placeholder
    display_order = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    asset = relationship("Asset", back_populates="object_asset_links")

    __table_args__ = (
        Index('idx_object_asset_link_object', 'object_type', 'object_id'),
        UniqueConstraint('asset_id', name='uq_object_asset_links_asset_id'),
    )


class RichTextImageRef(Base):
    __tablename__ = "rich_text_image_refs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    object_type = Column(String(50), nullable=False)
    object_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    language = Column(String(50), nullable=False)
    field_name = Column(String(100), nullable=False)
    position = Column(Integer, nullable=False)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    asset = relationship("Asset", back_populates="rich_text_image_refs")

    __table_args__ = (
        Index("ix_rich_text_image_refs_project_asset", "project_id", "asset_id"),
        Index("ix_rich_text_image_refs_object_lang_field", "object_type", "object_id", "language", "field_name"),
        Index("ix_rich_text_image_refs_project_object", "project_id", "object_type"),
    )


# ============================================================================
# LLM REQUEST TRACKING
# ============================================================================

class LLMRequest(Base):
    """Persisted LLM request tracking row."""
    __tablename__ = "llm_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(String(40), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    thread_id = Column(UUID(as_uuid=True), nullable=False)
    run_id = Column(UUID(as_uuid=True), nullable=False)
    assistant_message_id = Column(UUID(as_uuid=True), nullable=False)
    provider = Column(String(50), nullable=False)
    model = Column(String(200), nullable=False)
    status = Column(String(20), nullable=False, default="running")
    retry_count = Column(Integer, nullable=False, default=0)
    raw_input = Column(JSONB, nullable=True)
    raw_output = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("request_id", name="uq_llm_requests_request_id"),
        UniqueConstraint("assistant_message_id", name="uq_llm_requests_assistant_message_id"),
        Index("ix_llm_requests_user_created", "user_id", created_at.desc()),
        Index("ix_llm_requests_run_id", "run_id"),
        Index("ix_llm_requests_thread_id", "thread_id"),
    )


class ThreadPromptCache(Base):
    """Persisted prompt cache artifacts and logical prefix rows."""
    __tablename__ = "thread_prompt_caches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String(50), nullable=False)
    model = Column(String(200), nullable=False)
    checkpoint_id = Column(String(120), nullable=False)
    prefix_digest = Column(String(128), nullable=False)
    strategy = Column(String(50), nullable=False)
    external_handle = Column(String(255), nullable=True)
    ttl_label = Column(String(32), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    last_hit_at = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    thread = relationship("Thread", back_populates="prompt_caches")
    user = relationship("User")
    project = relationship("Project")

    __table_args__ = (
        UniqueConstraint("thread_id", "provider", "model", "prefix_digest", name="uq_thread_prompt_caches_prefix"),
        Index("ix_thread_prompt_caches_thread_provider", "thread_id", "provider"),
        Index("ix_thread_prompt_caches_project_provider", "project_id", "provider"),
        CheckConstraint(
            "strategy IN ('logical_prefix','gemini_cached_content')",
            name="ck_thread_prompt_caches_strategy",
        ),
        CheckConstraint(
            "status IN ('active','expired','error')",
            name="ck_thread_prompt_caches_status",
        ),
    )
