
export type Role = "system" | "user" | "assistant" | "function";

export type ContentPartType = "content" | "thinking" | "reasoning";

export interface ContentPart {
  type: ContentPartType;
  text: string;
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface ConversationBlock {
  role: Role;
  content: string | null;
  function_call?: FunctionCall;
  name?: string; // for function role messages
}

// Reasoning detail from OpenRouter (model-native reasoning)
export interface ReasoningDetail {
  type: 'summary' | 'text' | 'encrypted';
  summary?: string;
  text?: string;
  signature?: string;
}

export interface FunctionCallMetadata {
  id: string;
  function_name: string;
  arguments: any;
  result?: any;
  isApplied: boolean;
  appliedAt?: Date;
  error?: string;
  resultMessage?: string; // Human-readable result message
}

// Helper interface for tracking function call results systematically
export interface FunctionCallResultSummary {
  functionCallId: string;
  functionName: string;
  success: boolean;
  resultMessage: string;
  appliedAt: Date;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
  contentParts?: ContentPart[];
  functionCalls?: FunctionCallMetadata[];
  reasoning_details?: ReasoningDetail[];
}


