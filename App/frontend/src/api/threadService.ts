import { apiClient } from './client';
import type { ImageRun } from './assetService';
import type { McpSelection } from '../types/mcp';
import type {
  ThreadInfo,
  ThreadMessage,
  ThreadStatus,
  ThreadToolCall,
} from '../types/thread';
import { toMessageAttachment, type PendingAttachment } from '../utils/threadAttachments';

export interface StartRunCommand {
  input_text: string;
  input_payload?: Record<string, any>;
  run_mode?: 'planMode' | 'agentMode';
  surface?: string;
  context_object_ids?: string[];
  journey_target_ids?: string[];
  language?: string;
  attachments?: PendingAttachment[];
  mcp_selections?: McpSelection[];
}

export interface StartRunJsonPayload {
  input_text: string;
  input_payload?: Record<string, any>;
  run_mode?: 'planMode' | 'agentMode';
  surface?: string;
  context_object_ids?: string[];
  journey_target_ids?: string[];
  language?: string;
  mcp_selections?: McpSelection[];
}

export type StartRunTransport =
  | { kind: 'json'; payload: StartRunJsonPayload }
  | { kind: 'multipart'; formData: FormData };

export interface ResumeRunRequest {
  run_mode?: 'planMode' | 'agentMode';
  surface?: string;
  context_object_ids?: string[];
  journey_target_ids?: string[];
  language?: string;
}

export interface ThreadRunResponse {
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
  pause_after_apply?: boolean;
}

export interface ThreadMessagesResponse {
  thread: ThreadInfo;
  latestRun: {
    id: string;
    status: ThreadStatus;
    runSeq: number;
    language: string;
    runMode: 'planMode' | 'agentMode' | null;
    surface: string | null;
    createdAt: string;
    updatedAt: string;
    inputPayload: Record<string, any>;
    contextObjectIds: string[];
    journeyTargetIds: string[];
  } | null;
  messages: ThreadMessage[];
  toolCalls: ThreadToolCall[];
  imageRuns: ImageRun[];
}

export interface ToolCallDecisionResponse {
  toolCall: ThreadToolCall;
}

export interface ToolCallBatchDecisionResponse {
  results: ToolCallDecisionResponse[];
}

export interface PatchMessageRequest {
  language: string;
  content_parts: Array<{ type: 'content'; text: string }>;
  reasoning_detail?: Record<string, unknown>;
}

export interface ProjectThreadRuntimeItem {
  id: string;
  projectId: string;
  threadType: ThreadInfo['threadType'];
  parentId: string | null;
  journeyKind: string | null;
  displayLabel: string | null;
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
    parentId: raw.parent_id ? String(raw.parent_id) : null,
    journeyKind: raw.journey_kind ? String(raw.journey_kind) : null,
    displayLabel: raw.display_label ? String(raw.display_label) : null,
    status: String(raw.status) as ThreadStatus,
    memoryBoundaryMessageId: raw.memory_boundary_message_id ? String(raw.memory_boundary_message_id) : null,
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
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map((item) => toMessageAttachment(item))
      : [],
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
    extraContent: (raw.extra_content ?? null) as Record<string, unknown> | null,
    status: String(raw.status) as ThreadToolCall['status'],
    reason: (raw.reason ?? null) as string | null,
    result: (raw.result ?? null) as Record<string, unknown> | null,
    imageRunId: raw.image_run_id ? String(raw.image_run_id) : null,
    childThreadId: raw.child_thread_id ? String(raw.child_thread_id) : null,
    acceptedAt: (raw.accepted_at ?? null) as string | null,
    createdAt: String(raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updated_at ?? new Date().toISOString()),
  };
}

function toDecisionResponse(raw: Record<string, unknown>): ToolCallDecisionResponse {
  return {
    toolCall: toToolCall((raw.tool_call ?? {}) as Record<string, unknown>),
  };
}

function toThreadRunResponse(raw: Record<string, unknown>): ThreadRunResponse {
  return {
    threadId: String(raw.thread_id),
    runId: String(raw.run_id),
    status: String(raw.status) as ThreadStatus,
    threadStatus: String(raw.thread_status) as ThreadStatus,
  };
}

function buildStartRunJsonPayload(command: StartRunCommand): StartRunJsonPayload {
  return {
    input_text: command.input_text,
    input_payload: command.input_payload,
    run_mode: command.run_mode,
    surface: command.surface,
    context_object_ids: command.context_object_ids,
    journey_target_ids: command.journey_target_ids,
    language: command.language,
    mcp_selections: command.mcp_selections,
  };
}

export function buildStartRunTransport(command: StartRunCommand): StartRunTransport {
  const attachments = command.attachments ?? [];
  const payload = buildStartRunJsonPayload(command);

  if (attachments.length === 0) {
    return {
      kind: 'json',
      payload,
    };
  }

  const formData = new FormData();
  formData.append('input_text', payload.input_text ?? '');
  if (payload.input_payload !== undefined) {
    formData.append('input_payload_json', JSON.stringify(payload.input_payload));
  }
  if (payload.run_mode) {
    formData.append('run_mode', payload.run_mode);
  }
  if (payload.surface) {
    formData.append('surface', payload.surface);
  }
  if (payload.context_object_ids) {
    formData.append('context_object_ids_json', JSON.stringify(payload.context_object_ids));
  }
  if (payload.journey_target_ids) {
    formData.append('journey_target_ids_json', JSON.stringify(payload.journey_target_ids));
  }
  if (payload.language) {
    formData.append('language', payload.language);
  }
  if (payload.mcp_selections) {
    formData.append('mcp_selections_json', JSON.stringify(payload.mcp_selections));
  }
  for (const attachment of attachments) {
    formData.append('attachments', attachment.file);
  }

  return {
    kind: 'multipart',
    formData,
  };
}

export const threadService = {
  async startRun(threadId: string, command: StartRunCommand): Promise<ThreadRunResponse> {
    const transport = buildStartRunTransport(command);
    const raw = transport.kind === 'multipart'
      ? await apiClient.postFormData<Record<string, unknown>>(
        `/api/v1/threads/${threadId}/start`,
        transport.formData,
      )
      : await apiClient.post<Record<string, unknown>>(
        `/api/v1/threads/${threadId}/start`,
        transport.payload,
      );

    return toThreadRunResponse(raw);
  },

  async resumeRun(threadId: string, req: ResumeRunRequest = {}): Promise<ThreadRunResponse> {
    const raw = await apiClient.post<Record<string, unknown>>(
      `/api/v1/threads/${threadId}/resume`,
      req,
    );
    return toThreadRunResponse(raw);
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
            runMode: latestRunRaw.run_mode === 'planMode' || latestRunRaw.run_mode === 'agentMode'
              ? latestRunRaw.run_mode
              : null,
            surface: typeof latestRunRaw.surface === 'string' && latestRunRaw.surface.length > 0
              ? latestRunRaw.surface
              : null,
            createdAt: String(latestRunRaw.created_at ?? new Date().toISOString()),
            updatedAt: String(latestRunRaw.updated_at ?? new Date().toISOString()),
            inputPayload: (latestRunRaw.input_payload ?? {}) as Record<string, any>,
            contextObjectIds: Array.isArray(latestRunRaw.context_object_ids)
              ? (latestRunRaw.context_object_ids as string[])
              : [],
            journeyTargetIds: Array.isArray(latestRunRaw.journey_target_ids)
              ? (latestRunRaw.journey_target_ids as string[])
              : [],
          }
        : null,
      messages: Array.isArray(raw.messages)
        ? raw.messages.map((m) => toMessage(m as Record<string, unknown>))
        : [],
      toolCalls: Array.isArray(raw.tool_calls)
        ? raw.tool_calls.map((t) => toToolCall(t as Record<string, unknown>))
        : [],
      imageRuns: Array.isArray(raw.image_runs)
        ? (raw.image_runs as ImageRun[])
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

  async cancelThread(threadId: string): Promise<void> {
    await apiClient.post(`/api/v1/threads/${threadId}/cancel`);
  },

  async pauseThread(threadId: string): Promise<void> {
    await apiClient.post(`/api/v1/threads/${threadId}/pause`);
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
