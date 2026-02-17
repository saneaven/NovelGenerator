export type ThreadType = 'agent' | 'subAgent' | 'journey';
export type ThreadStatus = 'idle' | 'running' | 'waiting_tools' | 'paused' | 'error';

export interface ThreadInfo {
  id: string;
  projectId: string;
  threadType: ThreadType;
  ownerId?: string | null;
  journeyKind?: string | null;
  status: ThreadStatus;
  lastError?: string | null;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  seq: number;
  seqInThread: number | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  data: Record<string, { contentParts: Array<{ type: string; text: string }>; thinkingDetails?: Array<Record<string, unknown>> }>;
  createdAt: string;
}

export interface ThreadToolCall {
  id: string;
  threadId: string;
  messageId: string;
  callSeq: number;
  llmCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'accepted' | 'rejected' | 'failed';
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
    case 'waiting_tools':
      return 1;
    case 'paused':
      return 2;
    case 'error':
      return 3;
    case 'idle':
      return 4;
    default:
      return 5;
  }
}

export function isBlockingThreadStatus(status: ThreadStatus): boolean {
  return status === 'running' || status === 'waiting_tools' || status === 'paused' || status === 'error';
}
