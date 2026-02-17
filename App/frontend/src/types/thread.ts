export type ThreadType = 'agent' | 'subAgent' | 'journey';
export type ThreadStatus = 'running' | 'waiting' | 'processing' | 'paused' | 'done' | 'error' | 'canceled';
export type RunStatus = ThreadStatus;
export type ToolCallStatus = 'streaming' | 'validating' | 'pending' | 'processing' | 'failed' | 'rejected' | 'applied';

export interface ThreadInfo {
  id: string;
  projectId: string;
  threadType: ThreadType;
  ownerId?: string | null;
  journeyKind?: string | null;
  status: ThreadStatus;
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
  role: 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result';
  data: Record<string, { contentParts: Array<{ type: string; text: string }>; thinkingDetails?: Array<Record<string, unknown>> }>;
  isStreaming?: boolean;
  createdAt: string;
}

export interface ThreadToolCall {
  id: string;
  threadId: string;
  runId: string;
  messageId: string;
  assistantMessageId: string | null;
  resultMessageId: string | null;
  callSeq: number;
  llmCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  reason?: string | null;
  result?: Record<string, unknown> | null;
  childThreadId?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LangEntry {
  contentParts: Array<{ type: string; text: string }>;
  thinkingDetails?: Array<Record<string, unknown>>;
}

export interface DisplayMessageResult {
  contentParts: Array<{ type: string; text: string }>;
  thinkingDetails?: Array<Record<string, unknown>>;
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
      thinkingDetails: exact.thinkingDetails,
      displayLanguage: language,
      isFallback: false,
    };
  }

  if (fallbackLanguage) {
    const fallback = data[fallbackLanguage];
    if (fallback) {
      return {
        contentParts: fallback.contentParts ?? [],
        thinkingDetails: fallback.thinkingDetails,
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
      thinkingDetails: first.thinkingDetails,
      displayLanguage: languages[0],
      isFallback: true,
    };
  }

  return {
    contentParts: [],
    thinkingDetails: undefined,
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
  contentParts: Array<{ type: string; text: string }>,
  thinkingDetails?: Array<Record<string, unknown>>,
): LangEntry {
  return {
    contentParts,
    ...(thinkingDetails !== undefined ? { thinkingDetails } : {}),
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
  return status === 'running' || status === 'waiting' || status === 'processing' || status === 'paused';
}
