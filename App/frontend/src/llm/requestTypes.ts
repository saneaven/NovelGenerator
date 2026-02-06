import type { ToolCallStatus, ToolCallFailureType, ApplicationResult } from '../toolCall/types';

export type Role = "system" | "user" | "assistant" | "tool_results";

export type ContentPartType = "content" | "thinking";

export interface ContentPart {
  type: ContentPartType;
  text: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  extra_content?: Record<string, any>;
}

/**
 * Tool result block for sending tool call results back to the LLM.
 * Used in multi-turn conversations where the assistant made tool_calls.
 */
export interface ToolResultBlock {
  tool_call_id: string;
  tool_name: string;  // Required for Gemini provider
  content: string;
}

export interface ConversationBlock {
  role: Role;
  contentParts: ContentPart[];
  tool_calls?: ToolCall[]; // for assistant messages with tool calls
  tool_results?: ToolResultBlock[]; // for tool_results role messages
}

// Thinking detail from OpenRouter (model-native thinking)
export interface ThinkingDetail {
  type: 'summary' | 'text' | 'encrypted';
  summary?: string;
  text?: string;
  signature?: string;
}

// Token usage information from LLM response
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ToolCallMetadata {
  id: string;
  tool_name: string;
  arguments: any;
  extra_content?: Record<string, any>;
  /** Current status of the tool call */
  status: ToolCallStatus;
  /** Error message (when failed) or user-provided reason (when rejected) */
  reason?: string;
  /** Type of failure when status is 'failed' */
  failureType?: ToolCallFailureType;
  /** Result from applying the tool call (when accepted) */
  result?: ApplicationResult;
  /** Timestamp when the tool call was accepted */
  acceptedAt?: Date;
}

export type ToolCallProgressStatus = 'collecting' | 'validating' | 'ready' | 'error';

export interface ToolCallDraft {
  id: string;
  index: number;
  toolName: string;
  rawArguments: string;
  parsedArguments: any | null;
  extraContent?: Record<string, any>;
}

export interface ToolCallOperationFieldPreview {
  key: string;
  label: string;
  value: string;
}

export interface ToolCallOperationChapterPreview {
  name?: string;
  description?: string;
}

export interface ToolCallReplacementPreview {
  field?: string;
  old: string;
  new: string;
}

export interface ToolCallOperationPreview {
  key: string;
  action?: string;
  type?: string;
  id?: string;
  targetName?: string;
  summary?: string;
  data?: Record<string, any>;
  fields?: ToolCallOperationFieldPreview[];
  chapters?: ToolCallOperationChapterPreview[];
  missingFields?: string[];
  rawSnippet?: string;
  /** For PATCH operations - array of search/replace pairs */
  replacements?: ToolCallReplacementPreview[];
  /** For translation operations - target language code */
  targetLanguage?: string;
  /** Indices of failed replacements (for retry context display) */
  failedReplacementIndices?: number[];
}

export interface ToolCallProgress {
  draft: ToolCallDraft;
  status: ToolCallProgressStatus;
  preview?: any;
  rawPreview: string;
  operationPreviews?: ToolCallOperationPreview[];
  error?: string;
  updatedAt: number;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  /** Stable per-agent message order (1-based). May be absent for synthetic/local-only messages. */
  seq?: number;
  timestamp: Date;
  toolCalls?: ToolCallMetadata[];
  thinking_details?: ThinkingDetail[];
}

/**
 * Create a minimal history with an empty user message.
 * Use this for modes that don't have chat history but need a user block
 * to trigger template rendering (e.g., agent translation).
 */
export function createEmptyUserHistory(): ChatMessage[] {
  return [{
    id: 'empty-user',
    timestamp: new Date(),
    role: 'user',
    contentParts: [{ type: 'content', text: '' }],
  }];
}
