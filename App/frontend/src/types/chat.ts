/**
 * Shared chat/message/tool-call type definitions.
 *
 * These were previously in llm/requestTypes.ts. Moved here because the
 * frontend no longer owns prompt rendering — these are pure data shapes
 * shared between the API layer and UI components.
 */

import type { ToolCallStatus, ToolCallFailureType, ApplicationResult } from '../toolCall/types';

export type Role = 'system' | 'user' | 'assistant' | 'tool_results';

export type ContentPartType = 'content';

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

export interface ToolResultBlock {
  tool_call_id: string;
  tool_name: string;
  content: string;
}

export interface ConversationBlock {
  role: Role;
  contentParts: ContentPart[];
  tool_calls?: ToolCall[];
  tool_results?: ToolResultBlock[];
}

export interface ReasoningDetail {
  type: 'custom' | 'openai' | 'gemini' | 'claude' | 'openrouter' | 'openai_compatible_template' | 'xai';
  meta: {
    provider?: 'openai' | 'gemini' | 'claude' | 'openrouter' | 'custom' | 'xai';
    thinking_display?: string;
    openrouter_reasoning_format?: string;
    custom_thinking_template_id?: string;
  };
  data: Record<string, unknown>;
  token_count: number;
}

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
  status: ToolCallStatus;
  reason?: string;
  failureType?: ToolCallFailureType;
  result?: ApplicationResult;
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
  replacements?: ToolCallReplacementPreview[];
  targetLanguage?: string;
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
  seq?: number;
  timestamp: Date;
  toolCalls?: ToolCallMetadata[];
  reasoning_detail?: ReasoningDetail;
}
