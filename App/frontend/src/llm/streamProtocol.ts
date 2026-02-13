import type { ContentPart, ThinkingDetail, TokenUsage } from './requestTypes';

export type StreamToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  extra_content?: Record<string, unknown>;
};

export type FinalSnapshotToolCall = {
  id: string;
  tool_name: string;
  rawArguments: string;
  arguments: Record<string, unknown>;
  extra_content?: Record<string, unknown>;
  parseError?: string | null;
};

export type FinalSnapshot = {
  provider: string;
  model: string;
  finishReason: string;
  contentParts: ContentPart[];
  toolCalls: FinalSnapshotToolCall[];
  thinkingDetails: ThinkingDetail[];
  usage?: TokenUsage | null;
  finalSource: 'native' | 'reducer_fallback';
};

export type LLMDeltaEvent = {
  type: 'delta';
  seq: number;
  contentDelta: string | null;
  thinkingDelta: string | null;
  toolCallDeltas: StreamToolCallDelta[];
  thinkingDetailsDelta: ThinkingDetail[];
};

export type LLMFinalEvent = {
  type: 'final';
  snapshot: FinalSnapshot;
};

export type LLMErrorEvent = {
  type: 'error';
  message: string;
  status?: number;
};

export type LLMDoneEvent = {
  type: 'done';
  ok: boolean;
};

export type LLMStreamEvent = LLMDeltaEvent | LLMFinalEvent | LLMErrorEvent | LLMDoneEvent;
