import type { MutableRefObject } from 'react';
import type { ContentPart, FunctionCallMetadata, FunctionCallProgress, FunctionCallResultSummary } from './requestTypes';
import type { ProviderConfig, ProviderType, ThinkingConfig, RetryConfig } from '../store/settingsStore';
import type { FunctionCallSchema } from './schemas/chatFunctions';

/**
 * LLM Task Mode - determines which prompts and functions to use
 */
export const LLMTaskMode = {
  CHAT_WORKSPACE: 'chat_workspace',
  CHAT_NOVEL_EDITOR: 'chat_novel_editor',
  EDIT_ASSISTANT_MANUSCRIPT: 'edit_assistant_manuscript',
  EDIT_ASSISTANT_STORY_OBJECT: 'edit_assistant_story_object',
  TRANSLATION: 'translation',
  CHAT_TRANSLATION: 'chat_translation',
  OBJECT_IMAGE_PROMPT: 'object_image_prompt',
  SCENE_IMAGE_PROMPT: 'scene_image_prompt',
  COVER_IMAGE_PROMPT: 'cover_image_prompt',
} as const;

export type LLMTaskModeType = typeof LLMTaskMode[keyof typeof LLMTaskMode];

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
    isNativeOutputMode: boolean;
  };
  project: {
    basicInfo: { id: string; title: string; logline: string; genre: string } | null;
    objects: Array<{ type: string; id: string; name: string; description: string; imagePrompt?: string; imagePromptPositive?: string; imagePromptNegative?: string }>;
    outline: { acts: Array<{ id: string; name: string; description: string; chapters: Array<{ id: string; name: string; description: string }> }> } | null;
    manuscripts: Array<{ id: string; chapterId: string; chapterName: string; content: string; wordCount: number }>;
    languages: Record<string, any>;
  };
  input: {
    userMessage: string;
    functionResults?: Array<{ functionCallId: string; functionName: string; success: boolean; isRejected: boolean; resultMessage: string; appliedAt?: string }>;
  };
  // Mode-specific groups (only one should be set)
  chat?: {
    mode: 'workspace' | 'novelEditor';
    contextObjectIds?: string[];
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
    chatMessages?: Array<{ id: string; content: string }>;
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
}

/**
 * Base interface for all prompt contexts - all must include userInput
 */
export interface BasePromptContext {
  userInput: string;
  projectId?: string;  // For fetching project data from unifiedObjectStore
  outputLanguage?: string;
  enablePrefill?: boolean;
  enableThinking?: boolean;
  enableCustomThinking?: boolean;
}

/**
 * Context for workspace chat
 */
export interface ChatWorkspacePromptContext extends BasePromptContext {
  functions?: FunctionCallSchema[];
  storyObjects?: Record<string, any>;
  functionResults?: FunctionCallResultSummary[];
  contextObjectIds?: string[];
}

/**
 * Context for novel editor chat
 */
export interface ChatNovelEditorPromptContext extends BasePromptContext {
  functions?: FunctionCallSchema[];
  storyObjects?: Record<string, any>;
  novelData?: Record<string, any>;
  functionResults?: FunctionCallResultSummary[];
  contextObjectIds?: string[];
}

/**
 * Context for story object editing (Edit Assistant - Story Object)
 */
export interface EditAssistantStoryObjectPromptContext extends BasePromptContext {
  targetIds: string[];
  contextIds?: string[];
  categoryName?: string;
  editScope?: string;
  isNativeOutput?: boolean;
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
  isNativeOutput?: boolean;
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
  isNativeOutput?: boolean;
}

/**
 * Context for chat message translation
 */
export interface ChatTranslationPromptContext extends BasePromptContext {
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  isNativeOutput?: boolean;
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
  isNativeOutput?: boolean;
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
  isNativeOutput?: boolean;
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
  isNativeOutput?: boolean;
}

/**
 * Union type of all prompt contexts
 */
export type PromptContext =
  | ChatWorkspacePromptContext
  | ChatNovelEditorPromptContext
  | EditAssistantStoryObjectPromptContext
  | EditAssistantManuscriptPromptContext
  | StoryTranslationPromptContext
  | ChatTranslationPromptContext
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
  abortControllerRef: MutableRefObject<AbortController | null>;
  sessionId?: string;
  // Provider overrides (optional - defaults from settings)
  provider?: ProviderType;
  providerConfig?: ProviderConfig;
  // Model overrides (optional - defaults from settings)
  model?: string;
  temperature?: number;
  thinkingMode?: 'off' | 'model' | 'custom';
  thinkingConfig?: ThinkingConfig;
  retryConfig?: RetryConfig;
}

/**
 * LLM Task result
 */
export interface LLMTaskResult {
  contentParts: ContentPart[];
  functionCalls: FunctionCallMetadata[];
  thinkingDetails?: any[];
}

/**
 * LLM Task callbacks
 */
export interface LLMTaskCallbacks {
  onUpdate: (parts: ContentPart[]) => void;
  onComplete: (result: LLMTaskResult) => void | Promise<void>;
  onError: (error: Error) => void;
  onFunctionProgress?: (progress: FunctionCallProgress[]) => void;
}

/**
 * Prompt bundle returned by PromptManager
 */
export interface PromptBundle {
  systemPrompt: string;
  userPrompt: string;
  nonLastUserPrompt?: string;
  prefill?: string;
  templateData: TemplateData;
}
