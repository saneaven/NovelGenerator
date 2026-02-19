import { apiClient } from './client';
import type {
  ThreadInfo,
  ThreadMessage,
  ThreadStatus,
  ThreadToolCall,
} from '../types/thread';

export interface ChatRequest {
  input_text: string;
  input_payload?: Record<string, any>;
  run_mode?: 'planMode' | 'agentMode';
  surface?: string;
  context_object_ids?: string[];
  journey_target_ids?: string[];
  language?: string;
}

export interface ChatResponse {
  threadId: string;
  runId: string;
  status: ThreadStatus;
  threadStatus: ThreadStatus;
}

export interface ToolCallDecisionRequest {
  decision: 'accept' | 'reject';
  reason?: string;
}

export interface ToolCallBatchDecisionItem {
  tool_call_id: string;
  decision: 'accept' | 'reject';
  reason?: string;
}

export interface ToolCallBatchDecisionRequest {
  decisions: ToolCallBatchDecisionItem[];
}

export interface ThreadMessagesResponse {
  thread: ThreadInfo;
  latestRun: {
    id: string;
    status: ThreadStatus;
    runSeq: number;
    language: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  messages: ThreadMessage[];
  toolCalls: ThreadToolCall[];
}

export interface ToolCallDecisionResponse {
  toolCall: ThreadToolCall;
  newObjects: Array<Record<string, unknown>> | null;
}

export interface ToolCallBatchDecisionResponse {
  results: ToolCallDecisionResponse[];
}

export interface PatchMessageRequest {
  language: string;
  content_parts: Array<{ type: 'content' | 'thinking'; text: string }>;
  thinking_details?: Array<Record<string, unknown>>;
  set_final?: boolean;
}

export interface ProjectThreadRuntimeItem {
  id: string;
  projectId: string;
  threadType: ThreadInfo['threadType'];
  ownerId: string | null;
  journeyKind: string | null;
  status: ThreadStatus;
  lastError: string | null;
  updatedAt: string | null;
  latestRunId: string | null;
  latestRunStatus: ThreadStatus | null;
  latestMessageAt: string | null;
  unresolvedToolCallCount: number;
}

function toThreadInfo(raw: Record<string, unknown>): ThreadInfo {
  const out: ThreadInfo = {
    id: String(raw.id),
    projectId: String(raw.project_id),
    threadType: String(raw.thread_type) as ThreadInfo['threadType'],
    ownerId: raw.owner_id ? String(raw.owner_id) : null,
    journeyKind: raw.journey_kind ? String(raw.journey_kind) : null,
    status: String(raw.status) as ThreadStatus,
  };
  if (Object.prototype.hasOwnProperty.call(raw, 'last_error')) {
    out.lastError = (raw.last_error ?? null) as string | null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'updated_at')) {
    out.updatedAt = raw.updated_at ? String(raw.updated_at) : null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'latest_run_id')) {
    out.latestRunId = raw.latest_run_id ? String(raw.latest_run_id) : null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'latest_run_status')) {
    out.latestRunStatus = raw.latest_run_status
      ? String(raw.latest_run_status) as ThreadStatus
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'latest_message_at')) {
    out.latestMessageAt = raw.latest_message_at ? String(raw.latest_message_at) : null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'unresolved_tool_call_count')) {
    out.unresolvedToolCallCount = Number(raw.unresolved_tool_call_count ?? 0);
  }
  return out;
}

function toMessage(raw: Record<string, unknown>): ThreadMessage {
  return {
    id: String(raw.id),
    threadId: String(raw.thread_id),
    runId: String(raw.run_id),
    role: String(raw.role) as ThreadMessage['role'],
    seq: Number(raw.seq ?? 0),
    seqInThread: Number(raw.seq_in_thread ?? 0),
    data: (raw.data ?? {}) as ThreadMessage['data'],
    createdAt: String(raw.created_at ?? new Date().toISOString()),
    isStreaming: false,
  };
}

function toToolCall(raw: Record<string, unknown>): ThreadToolCall {
  return {
    id: String(raw.id),
    threadId: String(raw.thread_id),
    runId: String(raw.run_id),
    messageId: String(raw.message_id),
    assistantMessageId: raw.assistant_message_id ? String(raw.assistant_message_id) : null,
    callSeq: Number(raw.call_seq ?? 0),
    llmCallId: String(raw.llm_call_id ?? ''),
    toolName: String(raw.tool_name ?? ''),
    arguments: (raw.arguments ?? {}) as Record<string, unknown>,
    status: String(raw.status) as ThreadToolCall['status'],
    reason: (raw.reason ?? null) as string | null,
    result: (raw.result ?? null) as Record<string, unknown> | null,
    childThreadId: raw.child_thread_id ? String(raw.child_thread_id) : null,
    acceptedAt: (raw.accepted_at ?? null) as string | null,
    createdAt: String(raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updated_at ?? new Date().toISOString()),
  };
}

function toDecisionResponse(raw: Record<string, unknown>): ToolCallDecisionResponse {
  return {
    toolCall: toToolCall((raw.tool_call ?? {}) as Record<string, unknown>),
    newObjects: (raw.new_objects ?? null) as Array<Record<string, unknown>> | null,
  };
}

export const threadService = {
  async chat(threadId: string, req: ChatRequest): Promise<ChatResponse> {
    const raw = await apiClient.post<Record<string, unknown>>(
      `/api/v1/threads/${threadId}/chat`,
      req,
    );
    return {
      threadId: String(raw.thread_id),
      runId: String(raw.run_id),
      status: String(raw.status) as ThreadStatus,
      threadStatus: String(raw.thread_status) as ThreadStatus,
    };
  },

  async listMessages(threadId: string): Promise<ThreadMessagesResponse> {
    const raw = await apiClient.get<Record<string, unknown>>(`/api/v1/threads/${threadId}/messages`);
    const latestRunRaw = raw.latest_run as Record<string, unknown> | null | undefined;
    return {
      thread: toThreadInfo((raw.thread ?? {}) as Record<string, unknown>),
      latestRun: latestRunRaw
        ? {
            id: String(latestRunRaw.id),
            status: String(latestRunRaw.status) as ThreadStatus,
            runSeq: Number(latestRunRaw.run_seq ?? 0),
            language: String(latestRunRaw.language ?? ''),
            createdAt: String(latestRunRaw.created_at ?? new Date().toISOString()),
            updatedAt: String(latestRunRaw.updated_at ?? new Date().toISOString()),
          }
        : null,
      messages: Array.isArray(raw.messages)
        ? raw.messages.map((m) => toMessage(m as Record<string, unknown>))
        : [],
      toolCalls: Array.isArray(raw.tool_calls)
        ? raw.tool_calls.map((t) => toToolCall(t as Record<string, unknown>))
        : [],
    };
  },

  async decideToolCall(
    threadId: string,
    toolCallId: string,
    req: ToolCallDecisionRequest,
  ): Promise<ToolCallDecisionResponse> {
    const raw = await apiClient.patch<Record<string, unknown>>(
      `/api/v1/threads/${threadId}/tool-calls/${toolCallId}`,
      req,
    );
    return toDecisionResponse(raw);
  },

  async decideToolCallsBatch(
    threadId: string,
    req: ToolCallBatchDecisionRequest,
  ): Promise<ToolCallBatchDecisionResponse> {
    const raw = await apiClient.post<Record<string, unknown>>(
      `/api/v1/threads/${threadId}/tool-calls/decisions`,
      req,
    );
    const rows = Array.isArray(raw.results) ? raw.results : [];
    return {
      results: rows.map((row) => toDecisionResponse(row as Record<string, unknown>)),
    };
  },

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/threads/${threadId}/messages/${messageId}`);
  },

  async deleteToolCall(threadId: string, toolCallId: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/threads/${threadId}/tool-calls/${toolCallId}`);
  },

  async cancelRun(threadId: string, runId: string): Promise<void> {
    await apiClient.post(`/api/v1/threads/${threadId}/runs/${runId}/cancel`);
  },

  async createJourneyThread(
    projectId: string,
    journeyKind: 'objectEdit' | 'objectTranslation' | 'imagePrompt' | 'sceneImagePrompt' | 'messageTranslation',
  ): Promise<{ thread_id: string; status: ThreadStatus }> {
    return apiClient.post(`/api/v1/projects/${projectId}/threads`, {
      thread_type: 'journey',
      journey_kind: journeyKind,
    });
  },

  async updateMessage(
    threadId: string,
    messageId: string,
    req: PatchMessageRequest,
  ): Promise<ThreadMessage> {
    const raw = await apiClient.patch<Record<string, unknown>>(
      `/api/v1/threads/${threadId}/messages/${messageId}`,
      req,
    );
    return toMessage(raw);
  },

  async listProjectThreadRuntime(projectId: string): Promise<ProjectThreadRuntimeItem[]> {
    const raw = await apiClient.get<Record<string, unknown>>(`/api/v1/projects/${projectId}/threads/runtime`);
    const rows = Array.isArray(raw.threads) ? raw.threads : [];
    return rows.map((row) => toThreadInfo(row as Record<string, unknown>)) as ProjectThreadRuntimeItem[];
  },
};

export default threadService;
