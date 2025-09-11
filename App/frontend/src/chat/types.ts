import type { ConversationBlock, ChatMessage, Role } from '../llm_request/types';
import type { StoryObjects } from '../types/storyObject';
import type { FunctionCallSchema } from './types/functionCalling';

// Extend existing ChatMessage for pipeline processing
export interface ProcessedChatMessage extends ChatMessage {
  originalContent?: string;
  processedForAI?: boolean;
  editTags?: EditTag[];
}

// Edit tags that AI can use
export type EditTagType = 'init' | 'add' | 'edit' | 'remove';

export interface EditTag {
  type: EditTagType;
  content: any;
  id: string;
  isApplied?: boolean;
  summary?: string;
}

// System insertion mode for AI context
export interface SystemInsertConfig {
  enabled: boolean;
  includeProjectInfo: boolean;
  includeStoryObjects: boolean;
}

// Pipeline processing interfaces
export interface PreProcessingResult {
  conversationBlocks: ConversationBlock[];
  processedMessages: ProcessedChatMessage[];
  functions?: FunctionCallSchema[]; // For OpenAI function calling
}

export interface PostProcessingResult {
  message: ProcessedChatMessage;
  extractedEditTags: EditTag[];
}

export interface DisplayProcessingResult {
  displayContent: React.ReactNode;
  editCards: EditCard[];
}

// Edit card for display
export interface EditCard {
  id: string;
  type: EditTagType | 'system';
  title: string;
  description: string;
  isApplied: boolean;
  data: any;
  editTagData?: any; // Store the full edit tag data for direct access
  onApply: () => void;
  onReject: () => void;
}

// Chat pipeline context
export interface ChatPipelineContext {
  projectId: string;
  storyObjects: StoryObjects;
  systemInsertConfig: SystemInsertConfig;
}

// Pipeline processor interfaces
export interface PreProcessor {
  process(
    messages: ChatMessage[],
    context: ChatPipelineContext
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