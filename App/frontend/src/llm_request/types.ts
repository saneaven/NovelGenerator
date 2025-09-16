
export type Role = "system" | "user" | "assistant" | "function";

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
  functionCalls?: FunctionCallMetadata[]; // Function calling support
}


