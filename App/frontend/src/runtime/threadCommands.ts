import {
  type StartRunCommand,
  threadService,
  type ResumeRunRequest,
  type ToolCallDecisionResponse,
} from '../api/threadService';
import { requireSettingsFromCache } from '../data/settings';
import { useThreadStreamStore } from '../store/threadStreamStore';
import {
  getMergedThreadView,
  getMergedThreadMessages,
  upsertSnapshotToolCall,
  upsertSnapshotMessage,
  removeSnapshotMessage,
  readThreadSnapshotFromCache,
  clearThreadStreamingCache,
} from '../data/threads';
import { nowIso, toThreadType, type LatestRunContext, type ThreadInfo, type ThreadStatus } from '../types/thread';
import { isNonLiveThreadStatus } from './threadStreamLifecycle';
import { revokeMessageAttachmentObjectUrls, toOptimisticMessageAttachment } from '../utils/threadAttachments';

interface ThreadContextParams {
  threadId: string;
  projectId?: string;
  threadType?: ThreadInfo['threadType'];
}

export interface SendThreadMessageParams extends ThreadContextParams {
  inputText: string;
  request?: Omit<StartRunCommand, 'input_text'>;
}

export interface ResumeThreadParams extends ThreadContextParams {
  request?: ResumeRunRequest;
}

export interface CancelThreadParams {
  threadId: string;
}

export interface PauseThreadParams {
  threadId: string;
}

export interface DecideToolCallParams {
  threadId: string;
  toolCallId: string;
  decision: 'accept' | 'reject';
  reason?: string;
}

export interface DecideToolCallsBatchParams {
  threadId: string;
  decisions: Array<{
    toolCallId: string;
    decision: 'accept' | 'reject';
    reason?: string;
  }>;
  pauseAfterApply?: boolean;
}

function upsertThreadStatus(params: {
  threadId: string;
  projectId?: string;
  threadType?: ThreadInfo['threadType'];
  status: ThreadStatus;
  error: string | null;
  runId?: string | null;
  runStatus?: ThreadStatus | null;
}): void {
  const store = useThreadStreamStore.getState();
  const existing = store.threadsById[params.threadId];
  const partial: Partial<ThreadInfo> = {
    status: params.status,
    lastError: params.error,
    updatedAt: nowIso(),
    latestRunId: params.runId ?? null,
    latestRunStatus: params.runStatus ?? params.status,
  };

  if (existing) {
    // Guard against a stale command HTTP response regressing thread status.
    // startRun/resumeRun return the run-creation snapshot (running/processing).
    // If SSE has already advanced this same run to a settled state
    // (waiting/done/...), do not let the late response overwrite it.
    const sameRun = Boolean(params.runId && existing.latestRunId === params.runId);
    const wouldRegressToLive = sameRun
      && isNonLiveThreadStatus(existing.status)
      && !isNonLiveThreadStatus(params.status);
    if (wouldRegressToLive) {
      return;
    }
    store.patchThread(params.threadId, partial);
    return;
  }

  if (!params.projectId) return;

  store.upsertThread({
    id: params.threadId,
    projectId: params.projectId,
    threadType: toThreadType(params.threadType ?? 'agent'),
    parentId: null,
    journeyKind: null,
    status: params.status,
    lastError: params.error,
    updatedAt: nowIso(),
    latestRunId: params.runId ?? null,
    latestRunStatus: params.runStatus ?? params.status,
    latestMessageAt: null,
    unresolvedToolCallCount: 0,
  });
}

export function refreshUnresolvedCount(threadId: string): void {
  const view = getMergedThreadView(threadId);
  let unresolvedCount = 0;
  for (const toolCall of Object.values(view.toolCallsById)) {
    if (!toolCall) continue;
    if (
      toolCall.status === 'pending'
      || toolCall.status === 'streaming'
      || toolCall.status === 'validating'
      || toolCall.status === 'processing'
      || toolCall.status === 'working'
    ) {
      unresolvedCount += 1;
    }
  }
  useThreadStreamStore.getState().setThreadRuntime(threadId, {
    unresolvedToolCallCount: unresolvedCount,
    updatedAt: nowIso(),
  });
}

function applyToolDecisionResponse(response: ToolCallDecisionResponse): void {
  upsertSnapshotToolCall(response.toolCall);
  refreshUnresolvedCount(response.toolCall.threadId);
}

function toResumeRunRequest(request?: Omit<StartRunCommand, 'input_text'>): ResumeRunRequest | undefined {
  if (!request) return undefined;
  return {
    run_mode: request.run_mode,
    surface: request.surface,
    context_object_ids: request.context_object_ids,
    journey_target_ids: request.journey_target_ids,
  };
}

function toLatestRunContextFromRequest(
  request: Omit<StartRunCommand, 'input_text'>,
  fallbackLanguage: string,
): LatestRunContext {
  return {
    inputPayload: request.input_payload ?? {},
    contextObjectIds: request.context_object_ids ?? [],
    journeyTargetIds: request.journey_target_ids ?? [],
    language: fallbackLanguage,
    runMode: request.run_mode ?? null,
    surface: request.surface ?? null,
  };
}

export async function sendThreadMessage(params: SendThreadMessageParams): Promise<boolean> {
  useThreadStreamStore.getState().clearPreexistingLiveThread(params.threadId);

  const trimmed = params.inputText.trim();
  const requestAttachments = params.request?.attachments ?? [];
  const hasMcpSelections = (params.request?.mcp_selections?.length ?? 0) > 0;
  if (!trimmed && requestAttachments.length === 0 && !hasMcpSelections) {
    return await resumeThread({
      threadId: params.threadId,
      projectId: params.projectId,
      threadType: params.threadType,
      request: toResumeRunRequest(params.request),
    });
  }

  const lang = requireSettingsFromCache().mainLanguage;
  const existingMessages = getMergedThreadMessages(params.threadId);
  const maxSeq = existingMessages.reduce((max, message) => Math.max(max, message.seqInThread), 0);
  upsertSnapshotMessage({
    id: `optimistic:user:${Date.now()}`,
    threadId: params.threadId,
    runId: '',
    role: 'user',
    seq: 0,
    seqInThread: maxSeq + 1,
    data: {
      [lang]: {
        contentParts: trimmed ? [{ type: 'content', text: trimmed }] : [],
        meta: {
          mcpSelections: (params.request?.mcp_selections ?? []).map((selection) => ({
            selection_id: selection.selection_id,
            server_id: selection.server_id,
            kind: selection.kind,
            source_label: selection.server_id,
            summary_label: selection.kind === 'prompt' ? selection.prompt_name : selection.resource_uri,
          })),
        },
      },
    },
    attachments: requestAttachments.map((attachment, index) => toOptimisticMessageAttachment(attachment, index)),
    isStreaming: false,
    createdAt: nowIso(),
  });

  try {
    const command: StartRunCommand = {
      input_text: trimmed,
      ...(params.request ?? {}),
    };
    const response = await threadService.startRun(params.threadId, command);
    upsertThreadStatus({
      threadId: params.threadId,
      projectId: params.projectId,
      threadType: params.threadType,
      status: response.threadStatus,
      error: null,
      runId: response.runId,
      runStatus: response.status,
    });
    if (params.request) {
      useThreadStreamStore.getState().setThreadRuntime(params.threadId, {
        latestRunContext: toLatestRunContextFromRequest(params.request, lang),
      });
    }
    return true;
  } catch (error) {
    for (const message of readThreadSnapshotFromCache(params.threadId).messages) {
      if (message.id.startsWith('optimistic:user:')) {
        revokeMessageAttachmentObjectUrls(message);
        removeSnapshotMessage(params.threadId, message.id);
      }
    }
    throw error;
  }
}

export async function resumeThread(params: ResumeThreadParams): Promise<boolean> {
  useThreadStreamStore.getState().clearPreexistingLiveThread(params.threadId);

  const response = await threadService.resumeRun(params.threadId, params.request);
  upsertThreadStatus({
    threadId: params.threadId,
    projectId: params.projectId,
    threadType: params.threadType,
    status: response.threadStatus,
    error: null,
    runId: response.runId,
    runStatus: response.status,
  });
  return true;
}

export async function pauseThread(params: PauseThreadParams): Promise<void> {
  const store = useThreadStreamStore.getState();
  await threadService.pauseThread(params.threadId);
  store.setThreadRuntime(params.threadId, {
    status: 'paused',
    latestRunStatus: 'paused',
    updatedAt: nowIso(),
  });
  store.setThreadStreamActive(params.threadId, false);
}

export async function cancelThread(params: CancelThreadParams): Promise<void> {
  const store = useThreadStreamStore.getState();
  await threadService.cancelThread(params.threadId);
  store.setThreadRuntime(params.threadId, {
    status: 'canceled',
    latestRunStatus: 'canceled',
    lastError: null,
    updatedAt: nowIso(),
  });
  store.setThreadStreamActive(params.threadId, false);
  store.clearThreadStreamingState(params.threadId);
  clearThreadStreamingCache(params.threadId);
}

export async function decideToolCall(params: DecideToolCallParams): Promise<void> {
  const response = await threadService.decideToolCall(params.threadId, params.toolCallId, {
    decision: params.decision,
    reason: params.reason,
  });
  applyToolDecisionResponse(response);
}

export async function decideToolCallsBatch(params: DecideToolCallsBatchParams): Promise<void> {
  const decisions = params.decisions
    .filter((item) => item.toolCallId)
    .map((item) => ({
      tool_call_id: item.toolCallId,
      decision: item.decision,
      reason: item.reason,
    }));
  if (decisions.length === 0) return;

  const response = await threadService.decideToolCallsBatch(params.threadId, {
    decisions,
    pause_after_apply: params.pauseAfterApply ?? false,
  });
  response.results.forEach((item) => applyToolDecisionResponse(item));
}
