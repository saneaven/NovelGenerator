import type { ChatMessage, ContentPart, FunctionCallMetadata } from '../llm/requestTypes';

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
  editCards: EditCard[];
}

/**
 * Edit card for displaying function call results
 */
export interface EditCard {
  id: string;
  type: string | 'system';
  title: string;
  description: string;
  isApplied: boolean;
  isRejected?: boolean;
  data: any;
  editTagData?: any;
  appliedAt?: Date;
  functionCall?: FunctionCallMetadata;
  onApply?: () => void;
  onReject?: () => void;
  /** Validation error (e.g., missing required ID) - card cannot be applied */
  validationError?: string;
  /** Apply error (e.g., 404) - card stays pending after failed apply */
  applyError?: string;
}

/**
 * Context for display processing
 */
export interface LLMRequestPipelineContext {
  projectId: string;
  mode: 'novelEditor' | 'workspace';
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
