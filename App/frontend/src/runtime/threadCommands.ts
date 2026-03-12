import { threadService, type ChatRequest, type ToolCallDecisionResponse } from '../api/threadService';
import { useDisplayLanguageStore } from '../store/displayLanguageStore';
import { useSettingsStore } from '../store/settingsStore';
import { useThreadStore } from '../store/threadStore';
import { nowIso, toThreadType, type ThreadInfo, type ThreadStatus } from '../types/thread';
import { revokeMessageAttachmentObjectUrls, toOptimisticMessageAttachment } from '../utils/threadAttachments';

interface ThreadContextParams {
  threadId: string;
  projectId?: string;
  threadType?: ThreadInfo['threadType'];
}

export interface SendThreadMessageParams extends ThreadContextParams {
  inputText: string;
  request?: Omit<ChatRequest, 'input_text'>;
}

export interface ResumeThreadParams extends ThreadContextParams {
  request?: Omit<ChatRequest, 'input_text'>;
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
  const store = useThreadStore.getState();
  const existing = store.threadsById[params.threadId];
  const partial: Partial<ThreadInfo> = {
    status: params.status,
    lastError: params.error,
    updatedAt: nowIso(),
    latestRunId: params.runId ?? null,
    latestRunStatus: params.runStatus ?? params.status,
  };

  if (existing) {
    store.patchThread(params.threadId, partial);
    return;
  }

  if (!params.projectId) return;

  store.upsertThread({
    id: params.threadId,
    projectId: params.projectId,
    threadType: toThreadType(params.threadType ?? 'agent'),
    ownerId: null,
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

function refreshUnresolvedCount(threadId: string): void {
  const store = useThreadStore.getState();
  let unresolvedCount = 0;
  for (const toolCall of Object.values(store.toolCallsById)) {
    if (!toolCall || toolCall.threadId !== threadId) continue;
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
  store.setThreadRuntime(threadId, {
    unresolvedToolCallCount: unresolvedCount,
    updatedAt: nowIso(),
  });
}

function applyToolDecisionResponse(response: ToolCallDecisionResponse): void {
  const store = useThreadStore.getState();
  store.upsertToolCall(response.toolCall);

  refreshUnresolvedCount(response.toolCall.threadId);
}

export async function sendThreadMessage(params: SendThreadMessageParams): Promise<boolean> {
  useThreadStore.getState().setAutoContinuePaused(params.threadId, false);
  useThreadStore.getState().clearPreexistingLiveThread(params.threadId);

  const trimmed = params.inputText.trim();
  const requestAttachments = params.request?.attachments ?? [];
  if (!trimmed && requestAttachments.length === 0) {
    return await resumeThread({
      threadId: params.threadId,
      projectId: params.projectId,
      threadType: params.threadType,
      request: params.request,
    });
  }

  const store = useThreadStore.getState();
  const lang = useDisplayLanguageStore.getState().preferredDisplayLanguage
    || useSettingsStore.getState().getSettings().mainLanguage;
  const existingMessages = store.getMessages(params.threadId);
  const maxSeq = existingMessages.reduce((max, message) => Math.max(max, message.seqInThread), 0);
  store.appendMessage({
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
    const response = await threadService.chat(params.threadId, {
      input_text: trimmed,
      ...(params.request ?? {}),
    });
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
  } catch (error) {
    const messages = useThreadStore.getState().getMessages(params.threadId);
    for (const message of messages) {
      if (message.id.startsWith('optimistic:user:')) {
        revokeMessageAttachmentObjectUrls(message);
        useThreadStore.getState().removeMessage(params.threadId, message.id);
      }
    }
    throw error;
  }
}

export async function resumeThread(params: ResumeThreadParams): Promise<boolean> {
  useThreadStore.getState().setAutoContinuePaused(params.threadId, false);
  useThreadStore.getState().clearPreexistingLiveThread(params.threadId);

  const response = await threadService.chat(params.threadId, {
    input_text: '',
    ...(params.request ?? {}),
  });
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
  const store = useThreadStore.getState();
  store.setAutoContinuePaused(params.threadId, true);
  try {
    await threadService.pauseThread(params.threadId);
    store.setThreadRuntime(params.threadId, {
      status: 'paused',
      latestRunStatus: 'paused',
      updatedAt: nowIso(),
    });
    store.setThreadStreamActive(params.threadId, false);
  } catch (error) {
    store.setAutoContinuePaused(params.threadId, false);
    throw error;
  }
}

export async function cancelThread(params: CancelThreadParams): Promise<void> {
  useThreadStore.getState().setAutoContinuePaused(params.threadId, false);
  await threadService.cancelThread(params.threadId);
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
  });
  response.results.forEach((item) => applyToolDecisionResponse(item));
}
