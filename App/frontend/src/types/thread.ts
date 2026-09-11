import type { McpSelectionAudit } from './mcp';

export type ThreadType = 'agent' | 'subAgent' | 'journey';
export type ThreadStatus = 'running' | 'waiting' | 'processing' | 'ready' | 'paused' | 'done' | 'error' | 'canceled';
export type RunStatus = ThreadStatus;
export type ToolCallStatus = 'streaming' | 'validating' | 'pending' | 'processing' | 'working' | 'failed' | 'rejected' | 'applied';

export interface LatestRunContext {
  inputPayload: Record<string, any>;
  contextObjectIds: string[];
  journeyTargetIds: string[];
  language: string;
  runMode: 'planMode' | 'agentMode' | null;
  surface: string | null;
}

export interface ThreadInfo {
  id: string;
  projectId: string;
  threadType: ThreadType;
  parentId?: string | null;
  journeyKind?: string | null;
  displayLabel?: string | null;
  status: ThreadStatus;
  memoryBoundaryMessageId?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
  latestRunId?: string | null;
  latestRunStatus?: ThreadStatus | null;
  latestMessageAt?: string | null;
  unresolvedToolCallCount?: number;
  latestRunContext?: LatestRunContext | null;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  seqInThread: number;
  role: 'user' | 'assistant' | 'system' | 'tool_call';
  data: Record<string, LangEntry>;
  attachments: MessageAttachment[];
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
  type: string;
  meta: {
    provider?: string;
    thinking_display?: string;
    openrouter_reasoning_format?: string;
    custom_thinking_template_id?: string;
  };
  data: Record<string, unknown>;
  token_count: number;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  sortOrder: number;
  kind: 'image' | 'document' | 'text_file';
  mimeType: string;
  originalFilename: string;
  fileSize: number;
  url: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string | null;
}

export interface LangEntry {
  contentParts: Array<{ type: 'content'; text: string }>;
  reasoningDetail?: ReasoningDetail;
  meta?: {
    mcpSelections?: McpSelectionAudit[];
  };
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

export function isPausedLikeThreadStatus(status: ThreadStatus | null | undefined): boolean {
  return status === 'paused' || status === 'error';
}

export function canResumeThreadStatus(status: ThreadStatus | null | undefined): boolean {
  return status === 'ready' || isPausedLikeThreadStatus(status);
}

export function canPauseThreadStatus(status: ThreadStatus | null | undefined): boolean {
  return status === 'running' || status === 'waiting' || status === 'processing';
}

export function canCancelThreadStatus(status: ThreadStatus | null | undefined): boolean {
  return status === 'ready' || canPauseThreadStatus(status) || isPausedLikeThreadStatus(status);
}

export function threadPriority(status: ThreadStatus): number {
  switch (status) {
    case 'running':
      return 0;
    case 'processing':
      return 1;
    case 'waiting':
      return 2;
    case 'ready':
    case 'paused':
    case 'error':
      return 3;
    case 'done':
      return 4;
    case 'canceled':
      return 5;
    default:
      return 6;
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
