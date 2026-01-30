// LLM Module - Core streaming and prompt management

export { LLMTask } from './LLMTask';
export { PromptManager } from './PromptManager';
export {
  LLMTaskMode,
  type LLMTaskModeType,
  type OutputMode,
  type LLMTaskConfig,
  type LLMTaskResult,
  type LLMTaskCallbacks,
  type PromptBundle,
  type PromptContext,
  type BasePromptContext,
  type AgentWorkspacePromptContext,
  type AgentNovelEditorPromptContext,
  type AgentOutlineManagerPromptContext,
  type AgentMemorySummaryPromptContext,
  type EditAssistantStoryObjectPromptContext,
  type EditAssistantManuscriptPromptContext,
  type StoryTranslationPromptContext,
  type AgentTranslationPromptContext,
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
  type ConversationBlock,
  type ThinkingDetail,
  type ToolCallMetadata,
  type ToolCallProgressStatus,
  type ToolCallDraft,
  type ToolCallOperationFieldPreview,
  type ToolCallOperationChapterPreview,
  type ToolCallOperationPreview,
  type ToolCallProgress,
  type ChatMessage,
  createEmptyUserHistory,
} from './requestTypes';

// Re-export LLM service functions (moved from llm_request/)
export { streamLLM, BackendError, fetchModels, fetchProviders, fetchModelEndpoints } from './llmService';

// Tool schemas - all from unified toolCall module
export {
  type ToolCallSchema,
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  STORY_OBJECT_EDIT_TOOLS,
  MANUSCRIPT_EDIT_TOOLS,
  OUTLINE_EDIT_TOOLS,
  getToolsForSet,
  type ToolSetName,
} from '../toolCall';

export {
  OBJECT_IMAGE_PROMPT_TOOL,
  SCENE_IMAGE_PROMPT_TOOL,
  OBJECT_IMAGE_PROMPT_TOOLS,
  SCENE_IMAGE_PROMPT_TOOLS,
} from './schemas/imagePromptTools';
