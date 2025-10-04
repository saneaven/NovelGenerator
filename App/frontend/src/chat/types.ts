import type { ConversationBlock, ChatMessage } from '../llm_request/types';
import type { StoryObjects } from '../types/storyObject';
import type { FunctionCallSchema } from './types/functionCalling';

// Extend existing ChatMessage for pipeline processing
export interface ProcessedChatMessage extends ChatMessage {
  originalContent?: string;
}

// System insertion mode for AI context
export interface SystemInsertConfig {
  enabled: boolean;
  includeProjectInfo: boolean;
  includeStoryObjects: boolean;
  includeNovelContent: boolean;
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
  mode: 'novel-editor' | 'workspace'; // Explicit mode distinction
}

// Pipeline processor interfaces
export interface PreProcessor {
  process(
    messages: ChatMessage[],
    context: ChatPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ): PreProcessingResult;
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
