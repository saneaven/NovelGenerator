import type { ChatMessage, ContentPart } from '../llm/requestTypes';

// Re-export EditCard from functionCall module for compatibility
export type { EditCard } from '../functionCall/types';

/**
 * Extended ChatMessage for display processing
 */
export interface ProcessedChatMessage extends ChatMessage {
  originalContent?: string;
  originalContentParts?: ContentPart[];
}

/**
 * Result of display processing
 */
export interface DisplayProcessingResult {
  displayContent: React.ReactNode;
  editCards: import('../functionCall/types').EditCard[];
}

/**
 * Context for display processing
 */
export interface LLMRequestPipelineContext {
  projectId: string;
  mode: 'novelEditor' | 'storyObject';
}

/**
 * Display processor interface
 */
export interface DisplayProcessor {
  process(
    message: ProcessedChatMessage,
    context: LLMRequestPipelineContext
  ): DisplayProcessingResult;
}
