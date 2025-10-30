import type { ConversationBlock, ChatMessage, ContentPart } from '../llm_request/types';
import type { StoryObjects } from '../types/storyObject';
import type { FunctionCallSchema } from './types/functionCalling';
import type {
  ChatSystemPromptContext,
  TranslationPromptContext,
  StoryObjectEditPromptContext,
  ChapterEditPromptContext,
} from './managers/SystemPromptManager';

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
  promptType?: 'chat' | 'translation' | 'story_object_edit' | 'chapter_edit';
  promptContext?: ChatSystemPromptContext | TranslationPromptContext | StoryObjectEditPromptContext | ChapterEditPromptContext;
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
  data: any;
  editTagData?: any; // Store the full edit tag data for direct access
  appliedAt?: Date; // When the card was applied
  onApply: () => void;
  onReject: () => void;
}

// Chat pipeline context
export interface ChatPipelineContext {
  projectId: string;
  storyObjects: StoryObjects;
  systemInsertConfig: SystemInsertConfig;
  novelData?: any; // Novel content data
  mode: 'novelEditor' | 'workspace'; // Explicit mode distinction
  enablePrefill?: boolean; // Enable assistant prefill at the end
  thinkingMode?: 'off' | 'model' | 'custom'; // Thinking mode: off, model-native reasoning, or custom prompt-based
  reasoningConfig?: {
    effort?: 'low' | 'medium' | 'high';
    maxTokens?: number;
  };
}

// Pipeline processor interfaces
export interface PreProcessor {
  process(
    messages: ChatMessage[],
    context: ChatPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ): Promise<PreProcessingResult>;
}

export interface PostProcessor {
  process(
    aiResponse: string | { content: string | null; tool_calls?: any[] },
    context: ChatPipelineContext
  ): PostProcessingResult;
}

export interface DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    context: ChatPipelineContext
  ): DisplayProcessingResult;
}
