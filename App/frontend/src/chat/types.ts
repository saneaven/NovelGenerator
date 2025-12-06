import type { ChatMessage, ContentPart, FunctionCallMetadata } from '../llm/requestTypes';

/**
 * Extended ChatMessage for display processing
 */
export interface ProcessedChatMessage extends ChatMessage {
  originalContent?: string;
  originalContentParts?: ContentPart[];
}

/**
 * System insert configuration for chat context
 */
export interface SystemInsertConfig {
  enabled: boolean;
  includeProjectInfo: boolean;
  includeStoryObjects: boolean;
  includeNovelContent: boolean;
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
}

/**
 * Context for display processing (simplified - most fields unused)
 */
export interface LLMRequestPipelineContext {
  projectId: string;
  storyObjects: any;
  systemInsertConfig: SystemInsertConfig;
  novelData?: any;
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
