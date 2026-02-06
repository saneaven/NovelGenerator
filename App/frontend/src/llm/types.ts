import type { ContentPart, ToolCallMetadata, ToolCallProgress, TokenUsage } from './requestTypes';
import type { ProviderConfig, ProviderType, ThinkingConfig, RetryConfig, CustomApiFormat } from '../store/settingsStore';
import type { ToolCallSchema } from '../toolCall';

/**
 * LLM Task Mode - determines which prompts and functions to use
 */
export const LLMTaskMode = {
  AGENT_STORYOBJECT: 'agent_storyObject',
  AGENT_NOVEL_EDITOR: 'agent_novel_editor',
  AGENT_OUTLINE_MANAGER: 'agent_outline_manager',
  AGENT_MEMORY_SUMMARY: 'agent_memory_summary',
  EDIT_ASSISTANT_MANUSCRIPT: 'edit_assistant_manuscript',
  EDIT_ASSISTANT_STORY_OBJECT: 'edit_assistant_story_object',
  TRANSLATION: 'translation',
  AGENT_TRANSLATION: 'agent_translation',
  OBJECT_IMAGE_PROMPT: 'object_image_prompt',
  SCENE_IMAGE_PROMPT: 'scene_image_prompt',
  COVER_IMAGE_PROMPT: 'cover_image_prompt',
  SUB_AGENT: 'sub_agent',
} as const;

export type LLMTaskModeType = typeof LLMTaskMode[keyof typeof LLMTaskMode];

/**
 * Output mode - determines how LLM output is interpreted
 *
 * - tool_call: provider-native tool calling (tools/functions included in request)
 * - native_tool_call: model emits <tool_calls> tags in text; backend parses into tool_calls deltas
 * - raw_output: plain text content only (no tool schemas, no parsing/conversion)
 */
export type OutputMode = 'tool_call' | 'native_tool_call' | 'raw_output';

/**
 * Thinking mode - determines how thinking/reasoning is handled
 *
 * - off: no thinking instructions or prefill
 * - model: use model-native thinking (provider's extended thinking feature)
 * - custom: include custom thinking instructions in prompt
 */
export type ThinkingMode = 'off' | 'model' | 'custom';

export type AgentRelevantChatToolCall = {
  id?: string;
  name: string;
  status: string;
  result: string;
};

// Prompt-injected memory chat (data-only; formatting should be done in prompt templates/fragments).
export type AgentRelevantChat = {
  messageId: string;
  role: string;
  // Snippet matched by memory search (best chunk text)
  matched_snippet?: string;
  // Match metadata for template branching
  match?: {
    kind: 'content' | 'tool_call' | 'unknown';
    fieldPath?: string | null;
    chunkIndex?: number | null;
  };
  toolCall?: AgentRelevantChatToolCall;
  original?: {
    content_parts: ContentPart[];
    tool_calls: ToolCallMetadata[];
  };
};

/**
 * Template data structure passed to all templates
 * Uses unified schema: config/project/input + mode-specific groups
 */
export interface TemplateData {
  config: {
    mainLanguage: string;
    displayLanguage: string;
    today: string;
    thinkingMode: ThinkingMode;
    isPrefillEnabled: boolean;
    outputMode: OutputMode;
  };
  project: {
    basicInfo: { id: string; title: string; logline: string; genre: string };
    objects: Array<{ type: string; id: string; name: string; description: string; content: string; imagePrompt?: string; imagePromptPositive?: string; imagePromptNegative?: string }>;
    outline: {
      outlines: Array<{
        id: string;
        name: string;
        description: string;
        content: string;
        order: number;
        acts: Array<{
          id: string;
          name: string;
          description: string;
          content: string;
          order: number;
          outlineId: string;
          chapters: Array<{
            id: string;
            name: string;
            description: string;
            content: string;
            order: number;
            actId: string;
          }>;
        }>;
      }>;
    } | null;
    manuscripts: Array<{ id: string; chapterId: string; chapterName: string; content: string; wordCount: number }>;
    languages: Record<string, any>;
    guidelines: {
      id: string;
      authorNote: string;
    };
  };
  input: {
    // userMessage is injected per user block in prepareMessages()
    userMessage?: string;
    // Message passed from the parent Agent into a Sub Agent invocation (call_{agent_name} args.input)
    agentMessage?: string;
  };
  feedback?: {
    editingObjectIds: string[];
  };
  // Mode-specific groups (only one should be set)
  agent?: {
    mode: 'storyObject' | 'novelEditor' | 'outlineManager';
    contextObjectIds?: string[];
    selectedOutlineId?: string;
    selectedActId?: string;
    previousSummaries?: string[];
    relevantChats?: AgentRelevantChat[];
  };
  memorySummary?: {
    previousSummary: string;
    messages: Array<{
      role: string;
      content: string;
      messageId: string;
      createdAt?: string;
    }>;
    language: string;
    archiveUntilMessageId: string;
  };
  editAssistant?: {
    mode: 'manuscript' | 'storyObject';
    manuscript?: {
      currentId: string;
      currentChapterId: string;
      currentChapterName: string;
      currentChapterManuscript: string;
      objectIds?: string[];
    };
    storyObject?: {
      targetIds: string[];
      contextIds?: string[];
      categoryName?: string;
      editScope?: string;
    };
  };
  translation?: {
    sourceLanguage: string;
    targetLanguage: string;
    objectIds?: string[];
    contextObjectIds?: string[];
    currentTranslatedContents?: Array<{ id: string; type: string; name: string; translatedContent: string }>;
    messages?: Array<{ id: string; content: string }>;
  };
  imagePrompt?: {
    promptMode: 'natural' | 'positive' | 'negative';
    currentObject?: {
      type?: string;
      name: string;
      description: string;
      content: string;
      image_prompt: string | null;
      image_prompt_positive: string | null;
      image_prompt_negative: string | null;
    };
    scenePreContext?: string;
    scenePostContext?: string;
    selectedObjectIds?: string[];
    // For cover image prompts
    coverImage?: {
      title: string;
      logline: string;
      genre: string;
    };
  };
  // User-defined prompt variables
  variables?: Record<string, string | number | boolean | null>;
}

/**
 * Base interface for all prompt contexts
 * Note: userInput removed - input.userMessage is injected per-message in LLMTask.prepareMessages()
 */
export interface BasePromptContext {
  projectId?: string;  // For fetching project data from unifiedObjectStore
  outputLanguage?: string;
  enablePrefill?: boolean;
  thinkingMode?: ThinkingMode;
  outputMode?: OutputMode;
}

/**
 * Context for workspace agent
 */
export interface AgentWorkspacePromptContext extends BasePromptContext {
  tools?: ToolCallSchema[];
  contextObjectIds?: string[];
  previousSummaries?: string[];
  relevantChats?: AgentRelevantChat[];
}

/**
 * Context for Sub Agent execution
 */
export interface SubAgentPromptContext extends BasePromptContext {
  tools?: ToolCallSchema[];
  /** Prompt template key (also the tool suffix for call_{agent_name}). */
  agentName: string;
}

/**
 * Context for novel editor agent
 * Note: This is now identical to AgentWorkspacePromptContext.
 * The only difference between workspace and novelEditor modes is the systemPrompt template.
 * Manuscripts are included via contextObjectIds, not a separate novelData field.
 */
export interface AgentNovelEditorPromptContext extends BasePromptContext {
  tools?: ToolCallSchema[];
  contextObjectIds?: string[];
  previousSummaries?: string[];
  relevantChats?: AgentRelevantChat[];
}

/**
 * Context for outline manager agent
 * Used for AI-assisted story structure planning and organization.
 */
export interface AgentOutlineManagerPromptContext extends BasePromptContext {
  tools?: ToolCallSchema[];
  contextObjectIds?: string[];
  selectedOutlineId?: string;
  selectedActId?: string;
  previousSummaries?: string[];
  relevantChats?: AgentRelevantChat[];
}

/**
 * Context for agent long-term memory summarization (rolling summary).
 */
export interface AgentMemorySummaryPromptContext extends BasePromptContext {
  memorySummary: {
    previousSummary: string;
    messages: Array<{
      role: string;
      content: string;
      messageId: string;
      createdAt?: string;
    }>;
    language: string;
    archiveUntilMessageId: string;
  };
}

/**
 * Context for story object editing (Edit Assistant - Story Object)
 */
export interface EditAssistantStoryObjectPromptContext extends BasePromptContext {
  targetIds: string[];
  contextIds?: string[];
  categoryName?: string;
  editScope?: string;
}

/**
 * Context for manuscript editing (Edit Assistant - Manuscript)
 */
export interface EditAssistantManuscriptPromptContext extends BasePromptContext {
  currentId: string;
  currentChapterId: string;
  currentChapterName: string;
  currentChapterContent: string;
  objectIds?: string[];
  contextData?: Record<string, unknown>;
}

/**
 * Current translated content for objects being edited
 */
export interface CurrentTranslatedContent {
  id: string;
  type: string;
  name: string;
  translatedContent: string;
}

/**
 * Context for story translation (batch)
 */
export interface StoryTranslationPromptContext extends BasePromptContext {
  sourceLanguage: string;
  targetLanguage: string;
  objectCount: number;
  objectsArray: Record<string, any>[];
  contextObjectIds?: string[];
  currentTranslatedContents?: CurrentTranslatedContent[];
  contextData?: Record<string, any>;
}

/**
 * Context for agent message translation
 */
export interface AgentTranslationPromptContext extends BasePromptContext {
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
}

/**
 * Context for object image prompt generation
 */
export interface ObjectImagePromptContext extends BasePromptContext {
  promptMode: 'natural' | 'positive' | 'negative';
  currentObject: {
    type: 'character' | 'location' | 'organization' | 'lorebook';
    name: string;
    description: string;
    content: string;
    image_prompt: string | null;
    image_prompt_positive: string | null;
    image_prompt_negative: string | null;
  };
}

/**
 * Selected object context for scene image prompt
 */
export interface SelectedObjectContext {
  id: string;
  type: string;
  name: string;
  description: string;  // One-line summary for object indexes
  content: string;  // Full content
  imagePrompt?: string;
}

/**
 * Context for scene image prompt generation
 */
export interface SceneImagePromptContext extends BasePromptContext {
  promptMode: 'natural' | 'positive' | 'negative';
  scenePreContext: string;
  scenePostContext: string;
  selectedObjects: SelectedObjectContext[];
}

/**
 * Context for cover image prompt generation
 */
export interface CoverImagePromptContext extends BasePromptContext {
  promptMode: 'natural' | 'positive' | 'negative';
  basicInfo: {
    title: string;
    logline: string;
    genre: string;
  };
  selectedObjects: SelectedObjectContext[];
  currentObject: {
    type: 'basic_info';
    name: string;
    description: string;
    content: string;
    image_prompt: string | null;
    image_prompt_positive: string | null;
    image_prompt_negative: string | null;
  };
}

/**
 * Union type of all prompt contexts
 */
export type PromptContext =
  | AgentWorkspacePromptContext
  | AgentNovelEditorPromptContext
  | AgentMemorySummaryPromptContext
  | EditAssistantStoryObjectPromptContext
  | EditAssistantManuscriptPromptContext
  | StoryTranslationPromptContext
  | AgentTranslationPromptContext
  | ObjectImagePromptContext
  | SceneImagePromptContext
  | CoverImagePromptContext
  | SubAgentPromptContext;

/**
 * LLM Task configuration
 */
export interface LLMTaskConfig {
  mode: LLMTaskModeType;
  projectId: string;
  promptContext: PromptContext;
  abortController: AbortController;
  sessionId?: string;
  // Provider overrides (optional - defaults from settings)
  provider?: ProviderType;
  providerConfig?: ProviderConfig;
  // Model overrides (optional - defaults from settings)
  model?: string;
  temperature?: number;
  thinkingMode?: 'off' | 'model' | 'custom';
  thinkingConfig?: ThinkingConfig;
  customApiFormat?: CustomApiFormat;  // OpenAI-compatible dialect for custom provider
  retryConfig?: RetryConfig;
}

/**
 * LLM Task result - pure execution output (no store coupling)
 */
export type LLMTaskResult = {
  contentParts: ContentPart[];
  toolCalls: ToolCallMetadata[];
  thinkingDetails?: any[];
  usage?: TokenUsage;
  warning?: string;
  provider: ProviderType;
  model: string;
};

/**
 * LLM Task callbacks
 */
export interface LLMTaskCallbacks {
  onUpdate: (parts: ContentPart[]) => void;
  onToolCallProgress?: (progress: ToolCallProgress[]) => void;
}

/**
 * Prompt bundle returned by PromptManager
 *
 * User prompt templates:
 * - userPrompt: Default template for middle user messages
 * - firstUserPrompt: Optional template for the first user message
 * - lastUserPrompt: Optional template for the last user message
 *
 * Template selection priority (for single message): lastUserPrompt > firstUserPrompt > userPrompt
 */
export interface PromptBundle {
  systemPrompt: string;
  userPrompt: string;              // Default template for middle user messages in multi-turn
  initialUserPrompt?: string;      // Template for single user message case (rich context)
  firstUserPrompt?: string;        // Template for first user message in multi-turn
  lastUserPrompt?: string;         // Template for last user message in multi-turn
  /**
   * Which `input.*` field should receive the current message text when rendering `role=user` blocks.
   * - Most tasks: `userMessage`
   * - Sub Agent: `agentMessage` (parent Agent -> Sub Agent messages)
   */
  messageInputKey: 'userMessage' | 'agentMessage';
  prefill?: string;
  templateData: TemplateData;
}
