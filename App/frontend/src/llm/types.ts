import type { MutableRefObject } from 'react';
import type { ContentPart, ChatMessage, FunctionCallMetadata, FunctionCallProgress, FunctionCallResultSummary } from './requestTypes';
import type { ProviderConfig, ProviderType, ThinkingConfig, RetryConfig } from '../store/settingsStore';
import type { FunctionCallSchema } from './schemas/functionCalling';
import type { StoryObjectCategory } from '../types/storyObject';

/**
 * LLM Task Mode - determines which prompts and functions to use
 */
export const LLMTaskMode = {
  CHAT_WORKSPACE: 'chat_workspace',
  CHAT_NOVEL_EDITOR: 'chat_novel_editor',
  STORY_OBJECT_EDIT: 'story_object_edit',
  CHAPTER_EDIT: 'chapter_edit',
  TRANSLATION: 'translation',
  CHAT_TRANSLATION: 'chat_translation',
  OBJECT_IMAGE_PROMPT: 'object_image_prompt',
  SCENE_IMAGE_PROMPT: 'scene_image_prompt',
} as const;

export type LLMTaskModeType = typeof LLMTaskMode[keyof typeof LLMTaskMode];

/**
 * Template data structure passed to all templates
 */
export interface TemplateData {
  variable: Record<string, any>;
  state: Record<string, boolean>;
  context: Record<string, any>;
}

/**
 * Base interface for all prompt contexts - all must include userInput
 */
export interface BasePromptContext {
  userInput: string;
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
}

/**
 * Context for novel editor chat
 */
export interface ChatNovelEditorPromptContext extends BasePromptContext {
  functions?: FunctionCallSchema[];
  storyObjects?: Record<string, any>;
  novelData?: Record<string, any>;
  functionResults?: FunctionCallResultSummary[];
}

/**
 * Context for story object editing
 */
export interface StoryObjectEditPromptContext extends BasePromptContext {
  category: StoryObjectCategory;
  targetId?: string;
  contextData?: Record<string, unknown>;
  currentData: unknown;
  isNativeOutput?: boolean;
}

/**
 * Context for chapter editing
 */
export interface ChapterEditPromptContext extends BasePromptContext {
  chapterName: string;
  currentContent: string;
  contextData?: Record<string, unknown>;
  isNativeOutput?: boolean;
}

/**
 * Context for story translation (batch)
 */
export interface StoryTranslationPromptContext extends BasePromptContext {
  sourceLanguage: string;
  targetLanguage: string;
  objectCount: number;
  objectsArray: Record<string, any>[];
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
 * Union type of all prompt contexts
 */
export type PromptContext =
  | ChatWorkspacePromptContext
  | ChatNovelEditorPromptContext
  | StoryObjectEditPromptContext
  | ChapterEditPromptContext
  | StoryTranslationPromptContext
  | ChatTranslationPromptContext
  | ObjectImagePromptContext
  | SceneImagePromptContext;

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
  onComplete: (result: LLMTaskResult) => void;
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
