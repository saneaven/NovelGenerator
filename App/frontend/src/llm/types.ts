import type { ContentPart, FunctionCallMetadata, FunctionCallProgress, TokenUsage } from './requestTypes';
import type { ProviderConfig, ProviderType, ThinkingConfig, RetryConfig, CustomApiFormat } from '../store/settingsStore';
import type { FunctionCallSchema } from '../functionCall';

/**
 * LLM Task Mode - determines which prompts and functions to use
 */
export const LLMTaskMode = {
  AGENT_STORYOBJECT: 'agent_storyObject',
  AGENT_NOVEL_EDITOR: 'agent_novel_editor',
  AGENT_OUTLINE_MANAGER: 'agent_outline_manager',
  EDIT_ASSISTANT_MANUSCRIPT: 'edit_assistant_manuscript',
  EDIT_ASSISTANT_STORY_OBJECT: 'edit_assistant_story_object',
  TRANSLATION: 'translation',
  AGENT_TRANSLATION: 'agent_translation',
  OBJECT_IMAGE_PROMPT: 'object_image_prompt',
  SCENE_IMAGE_PROMPT: 'scene_image_prompt',
  COVER_IMAGE_PROMPT: 'cover_image_prompt',
} as const;

export type LLMTaskModeType = typeof LLMTaskMode[keyof typeof LLMTaskMode];

/**
 * Output mode - determines how LLM output is interpreted
 *
 * - tool_call: provider-native tool calling (tools/functions included in request)
 * - native_function_call: model emits <function_calls> tags in text; backend parses into tool_calls deltas
 * - raw_output: plain text content only (no tool schemas, no parsing/conversion)
 */
export type OutputMode = 'tool_call' | 'native_function_call' | 'raw_output';

/**
 * Template data structure passed to all templates
 * Uses unified schema: config/project/input + mode-specific groups
 */
export interface TemplateData {
  config: {
    mainLanguage: string;
    displayLanguage: string;
    today: string;
    isThinkingEnabled: boolean;
    isPrefillEnabled: boolean;
    isCustomThinkingEnabled: boolean;
    outputMode: OutputMode;
    isNativeFunctionCallMode: boolean;
    isRawOutputMode: boolean;
  };
  project: {
    basicInfo: { id: string; title: string; logline: string; genre: string };
    objects: Array<{ type: string; id: string; name: string; description: string; imagePrompt?: string; imagePromptPositive?: string; imagePromptNegative?: string }>;
    outline: {
      outlines: Array<{
        id: string;
        name: string;
        description: string;
        order: number;
        acts: Array<{
          id: string;
          name: string;
          description: string;
          order: number;
          outlineId: string;
          chapters: Array<{
            id: string;
            name: string;
            description: string;
            order: number;
            actId: string;
          }>;
        }>;
      }>;
    } | null;
    manuscripts: Array<{ id: string; chapterId: string; chapterName: string; content: string; wordCount: number }>;
    languages: Record<string, any>;
    guidelines: {
      authorNote: string;
    };
  };
  input: {
    // userMessage is injected per user block in prepareMessages()
    userMessage?: string;
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
    objectType?: string;
    objectInfo?: string;
    promptMode: 'natural' | 'positive' | 'negative';
    currentPrompt?: string;
    currentPromptPositive?: string;
    currentPromptNegative?: string;
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
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
  outputMode?: OutputMode;
}

/**
 * Context for workspace agent
 */
export interface AgentWorkspacePromptContext extends BasePromptContext {
  functions?: FunctionCallSchema[];
  contextObjectIds?: string[];
}

/**
 * Context for novel editor agent
 * Note: This is now identical to AgentWorkspacePromptContext.
 * The only difference between workspace and novelEditor modes is the systemPrompt template.
 * Manuscripts are included via contextObjectIds, not a separate novelData field.
 */
export interface AgentNovelEditorPromptContext extends BasePromptContext {
  functions?: FunctionCallSchema[];
  contextObjectIds?: string[];
}

/**
 * Context for outline manager agent
 * Used for AI-assisted story structure planning and organization.
 */
export interface AgentOutlineManagerPromptContext extends BasePromptContext {
  functions?: FunctionCallSchema[];
  contextObjectIds?: string[];
  selectedOutlineId?: string;
  selectedActId?: string;
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
  objectType: 'character' | 'location' | 'organization' | 'lorebook';
  objectInfo: string;
  currentPrompt?: string | null;
  currentPromptPositive?: string | null;
  currentPromptNegative?: string | null;
}

/**
 * Selected object context for scene image prompt
 */
export interface SelectedObjectContext {
  id: string;
  type: string;
  name: string;
  description: string;
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
  currentPrompt?: string | null;
  currentPromptPositive?: string | null;
  currentPromptNegative?: string | null;
}

/**
 * Union type of all prompt contexts
 */
export type PromptContext =
  | AgentWorkspacePromptContext
  | AgentNovelEditorPromptContext
  | EditAssistantStoryObjectPromptContext
  | EditAssistantManuscriptPromptContext
  | StoryTranslationPromptContext
  | AgentTranslationPromptContext
  | ObjectImagePromptContext
  | SceneImagePromptContext
  | CoverImagePromptContext;

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
  customApiFormat?: CustomApiFormat;  // For custom provider API format
  retryConfig?: RetryConfig;
}

/**
 * LLM Task result - pure execution output (no store coupling)
 */
export type LLMTaskResult = {
  contentParts: ContentPart[];
  functionCalls: FunctionCallMetadata[];
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
  onFunctionProgress?: (progress: FunctionCallProgress[]) => void;
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
  prefill?: string;
  templateData: TemplateData;
}
