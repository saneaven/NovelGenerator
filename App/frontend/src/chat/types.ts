import type { ConversationBlock, ChatMessage, ContentPart, FunctionCallMetadata } from '../llm_request/types';
import type { FunctionCallSchema } from './types/functionCalling';
import type {
  ChatSystemPromptContext,
  TranslationPromptContext,
  StoryObjectEditPromptContext,
  ChapterEditPromptContext,
  ImagePromptContext,
} from './managers/SystemPromptManager';
import type { ThinkingConfig } from '../store/settingsStore';

// Extend existing ChatMessage for pipeline processing
export interface ProcessedChatMessage extends ChatMessage {
  originalContent?: string;
  originalContentParts?: ContentPart[];
}

// System insertion mode for AI context
export interface SystemInsertConfig {
  enabled: boolean;
  includeProjectInfo: boolean;
  includeStoryObjects: boolean;
  includeNovelContent: boolean;
  // Prompt type category - all prompts are treated uniformly as categories
  promptType?: 'chat' | 'translation' | 'story_object_edit' | 'chapter_edit' | 'imagePrompt';
  promptContext?: ChatSystemPromptContext | TranslationPromptContext | StoryObjectEditPromptContext | ChapterEditPromptContext | ImagePromptContext;
}

// Pipeline processing interfaces
export interface PreProcessingResult {
  conversationBlocks: ConversationBlock[];
  processedMessages: ProcessedChatMessage[];
  functions?: FunctionCallSchema[]; // For OpenAI function calling
}

export interface PostProcessingResult {
  message: ProcessedChatMessage;
}

export interface DisplayProcessingResult {
  displayContent: React.ReactNode;
  editCards: EditCard[];
}

// Edit card for display
export interface EditCard {
  id: string;
  type: string | 'system';
  title: string;
  description: string;
  isApplied: boolean;
  isRejected?: boolean; // True if user explicitly rejected this card
  data: any;
  editTagData?: any; // Store the full edit tag data for direct access
  appliedAt?: Date; // When the card was applied
  functionCall?: FunctionCallMetadata; // Reference to the original function call metadata
  onApply?: () => void; // Optional - not needed when using grouped card
  onReject?: () => void; // Optional - not needed when using grouped card
}

// LLM request pipeline context
export interface LLMRequestPipelineContext {
  projectId: string;
  storyObjects: any; // Simplified story objects from store
  systemInsertConfig: SystemInsertConfig;
  novelData?: any; // Novel content data
  mode: 'novelEditor' | 'workspace'; // Explicit mode distinction
  enablePrefill?: boolean; // Enable assistant prefill at the end
  thinkingMode?: 'off' | 'model' | 'custom'; // Thinking mode: off, model-native thinking, or custom prompt-based
  thinkingConfig?: ThinkingConfig;
}

// Pipeline processor interfaces
export interface PreProcessor {
  process(
    messages: ChatMessage[],
    context: LLMRequestPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ): Promise<PreProcessingResult>;
}

export interface PostProcessor {
  process(
    aiResponse: string | { content: string | null; tool_calls?: any[] },
    context: LLMRequestPipelineContext
  ): PostProcessingResult;
}

export interface DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    context: LLMRequestPipelineContext
  ): DisplayProcessingResult;
}
