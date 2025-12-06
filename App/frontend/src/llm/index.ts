// LLM Module - Core streaming and prompt management

export { LLMTask } from './LLMTask';
export { PromptManager } from './PromptManager';
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
  type StoryObjectEditPromptContext,
  type ChapterEditPromptContext,
  type StoryTranslationPromptContext,
  type ChatTranslationPromptContext,
  type ObjectImagePromptContext,
  type SceneImagePromptContext,
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
} from './schemas/functionCalling';

export {
  EDIT_BASIC_INFO_FUNCTION,
  EDIT_CHARACTER_FUNCTION,
  EDIT_ORGANIZATION_FUNCTION,
  EDIT_LOCATION_FUNCTION,
  EDIT_LOREBOOK_FUNCTION,
  EDIT_ACT_FUNCTION,
  EDIT_CHAPTER_METADATA_FUNCTION,
  EDIT_OUTLINE_FUNCTION,
  EDIT_CHARACTERS_BATCH_FUNCTION,
  EDIT_ORGANIZATIONS_BATCH_FUNCTION,
  EDIT_LOCATIONS_BATCH_FUNCTION,
  EDIT_LOREBOOK_BATCH_FUNCTION,
  EDIT_ACTS_BATCH_FUNCTION,
  EDIT_CHAPTERS_BATCH_FUNCTION,
  CHAPTER_EDIT_FUNCTIONS,
  getEditFunctionSchema,
  getEditFunctionsForCategory,
  getAllEditFunctionSchemas,
} from './schemas/editFunctions';

export {
  TRANSLATION_FUNCTIONS,
  TRANSLATE_CHAT_MESSAGE_FUNCTION,
  CHAT_TRANSLATION_FUNCTIONS,
  TRANSLATION_FUNCTION_TO_TYPE,
  TRANSLATION_FUNCTION_NAMES,
} from './schemas/translationFunctions';

export {
  OBJECT_IMAGE_PROMPT_FUNCTION,
  SCENE_IMAGE_PROMPT_FUNCTION,
  OBJECT_IMAGE_PROMPT_FUNCTIONS,
  SCENE_IMAGE_PROMPT_FUNCTIONS,
} from './schemas/imagePromptFunctions';
