// LLM Module - Core streaming and prompt management

export { LLMTask } from './LLMTask';
export { PromptManager } from './PromptManager';
export { LLMTaskManager, type TaskHandle, type StartTaskOptions } from './LLMTaskManager';
export {
  LLMTaskMode,
  type LLMTaskModeType,
  type LLMTaskConfig,
  type LLMTaskResult,
  type LLMTaskCallbacks,
  type PromptBundle,
  type PromptContext,
  type BasePromptContext,
  type ChatWorkspacePromptContext,
  type ChatNovelEditorPromptContext,
  type EditAssistantStoryObjectPromptContext,
  type EditAssistantManuscriptPromptContext,
  type StoryTranslationPromptContext,
  type ChatTranslationPromptContext,
  type ObjectImagePromptContext,
  type SceneImagePromptContext,
  type CoverImagePromptContext,
  type SelectedObjectContext,
} from './types';

// Re-export request types (moved from llm_request/)
export {
  type Role,
  type ContentPartType,
  type ContentPart,
  type FunctionCall,
  type ConversationBlock,
  type ThinkingDetail,
  type FunctionCallMetadata,
  type FunctionCallProgressStatus,
  type FunctionCallDraft,
  type FunctionCallOperationFieldPreview,
  type FunctionCallOperationChapterPreview,
  type FunctionCallOperationPreview,
  type FunctionCallProgress,
  type FunctionCallResultSummary,
  type ChatMessage,
} from './requestTypes';

// Re-export LLM service functions (moved from llm_request/)
export { streamLLM, BackendError, fetchModels, fetchProviders, fetchModelEndpoints } from './llmService';

// Re-export function schemas (moved from chat/types/)
export {
  type FunctionCallSchema,
  type FunctionCallResult,
  type FunctionCallMessage,
  type FunctionResultMessage,
  WORKSPACE_FUNCTIONS,
  NOVEL_EDITOR_FUNCTIONS,
} from './schemas/chatFunctions';

// Edit functions are now exported from functionCall module
export {
  STORY_OBJECT_EDIT_FUNCTIONS,
  MANUSCRIPT_EDIT_FUNCTIONS,
} from '../functionCall';

export {
  TRANSLATION_FUNCTIONS,
  SET_CHAT_MESSAGE_TRANSLATION,
  CHAT_TRANSLATION_FUNCTIONS,
  SET_FUNCTION_NAMES,
  PATCH_FUNCTION_NAMES,
  ALL_TRANSLATION_FUNCTION_NAMES,
  FUNCTION_TO_OBJECT_TYPE,
} from './schemas/translationFunctions';

export {
  OBJECT_IMAGE_PROMPT_FUNCTION,
  SCENE_IMAGE_PROMPT_FUNCTION,
  OBJECT_IMAGE_PROMPT_FUNCTIONS,
  SCENE_IMAGE_PROMPT_FUNCTIONS,
} from './schemas/imagePromptFunctions';
