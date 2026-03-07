export type ThreadType = 'agent' | 'subAgent' | 'journey';
export type ThreadStatus = 'running' | 'waiting' | 'processing' | 'paused' | 'done' | 'error' | 'canceled';
export type RunStatus = ThreadStatus;
export type ToolCallStatus = 'streaming' | 'validating' | 'pending' | 'processing' | 'working' | 'failed' | 'rejected' | 'applied';

export interface ThreadInfo {
  id: string;
  projectId: string;
  threadType: ThreadType;
  ownerId?: string | null;
  journeyKind?: string | null;
  status: ThreadStatus;
  memoryBoundaryMessageId?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
  latestRunId?: string | null;
  latestRunStatus?: ThreadStatus | null;
  latestMessageAt?: string | null;
  unresolvedToolCallCount?: number;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  seqInThread: number;
  role: 'user' | 'assistant' | 'system' | 'tool_call';
  data: Record<string, LangEntry>;
  /** Transient streaming buffer — only present while `isStreaming` is true. */
  streamingData?: LangEntry;
  isStreaming?: boolean;
  createdAt: string;
}

export interface ThreadToolCall {
  id: string;
  threadId: string;
  runId: string;
  messageId: string;
  assistantMessageId: string | null;
  callSeq: number;
  llmCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  extraContent?: Record<string, unknown> | null;
  status: ToolCallStatus;
  reason?: string | null;
  result?: Record<string, unknown> | null;
  imageRunId?: string | null;
  childThreadId?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface LangEntry {
  contentParts: Array<{ type: 'content'; text: string }>;
  reasoningDetail?: ReasoningDetail;
}

export interface DisplayMessageResult {
  contentParts: Array<{ type: 'content'; text: string }>;
  reasoningDetail?: ReasoningDetail;
  displayLanguage: string;
  isFallback: boolean;
}

interface MessageWithData {
  data: Record<string, LangEntry>;
}

export function resolveRunMessageDisplay(
  message: MessageWithData,
  language: string,
  fallbackLanguage?: string,
): DisplayMessageResult {
  const data = message.data;

  const exact = data[language];
  if (exact) {
    return {
      contentParts: exact.contentParts ?? [],
      reasoningDetail: exact.reasoningDetail,
      displayLanguage: language,
      isFallback: false,
    };
  }

  if (fallbackLanguage) {
    const fallback = data[fallbackLanguage];
    if (fallback) {
      return {
        contentParts: fallback.contentParts ?? [],
        reasoningDetail: fallback.reasoningDetail,
        displayLanguage: fallbackLanguage,
        isFallback: true,
      };
    }
  }

  const languages = Object.keys(data);
  if (languages.length > 0) {
    const first = data[languages[0]];
    return {
      contentParts: first.contentParts ?? [],
      reasoningDetail: first.reasoningDetail,
      displayLanguage: languages[0],
      isFallback: true,
    };
  }

  return {
    contentParts: [],
    reasoningDetail: undefined,
    displayLanguage: language,
    isFallback: false,
  };
}

export function getRunMessageText(
  message: MessageWithData,
  language: string,
  fallbackLanguage?: string,
): string {
  const { contentParts } = resolveRunMessageDisplay(message, language, fallbackLanguage);
  return contentParts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('');
}

export function buildLangEntry(
  contentParts: Array<{ type: 'content'; text: string }>,
  reasoningDetail?: ReasoningDetail,
): LangEntry {
  return {
    contentParts,
    ...(reasoningDetail !== undefined ? { reasoningDetail } : {}),
  };
}

export function threadPriority(status: ThreadStatus): number {
  switch (status) {
    case 'running':
      return 0;
    case 'processing':
      return 1;
    case 'waiting':
      return 2;
    case 'paused':
      return 3;
    case 'error':
      return 4;
    case 'done':
      return 5;
    case 'canceled':
      return 6;
    default:
      return 7;
  }
}

export function isBlockingThreadStatus(status: ThreadStatus): boolean {
  return status !== 'done' && status !== 'canceled';
}

export function toThreadType(raw: string | null | undefined): ThreadType {
  if (raw === 'subAgent') return 'subAgent';
  if (raw === 'journey') return 'journey';
  return 'agent';
}

export function nowIso(): string {
  return new Date().toISOString();
}
