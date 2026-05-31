import { threadService, type ToolCallDecisionResponse } from '../../api/threadService';
import type { ThreadRuntimeEvent } from '../../api/sseClient';
import { useJourneyStore } from '../../store/journeyStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useThreadStore } from '../../store/threadStore';
import { fetchAndReplaceThreadSnapshot } from '../threadHydration';
import { isLiveThreadStatus, isNonLiveThreadStatus } from '../threadStreamLifecycle';
import {
  toThreadType,
  nowIso,
  type ReasoningDetail,
  type ThreadInfo,
  type ThreadMessage,
  type ThreadStatus,
  type ThreadToolCall,
  type ToolCallStatus,
} from '../../types/thread';
import { getByDotPath, setByDotPath } from '../../utils/dotPath';
import { revokeMessageAttachmentObjectUrls, toMessageAttachment } from '../../utils/threadAttachments';

type AutoApproveConfig = Record<string, boolean>;

function getToolCategory(toolCall: ThreadToolCall): string | null {
  const meta = toolCall.extraContent?.__tool_meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const category = (meta as Record<string, unknown>).category;
    if (typeof category === 'string' && category) return category;
  }

  const toolName = toolCall.toolName;
  if (toolName.startsWith('read_') || toolName.startsWith('search_') || toolName === 'get_project_tree') return 'read';
  if (toolName.startsWith('delete_')) return 'delete';
  if (toolName.startsWith('translate_') || toolName.startsWith('patch_translation_')) return 'translate';
  if (toolName.startsWith('call_')) return 'sub_agent';
  if (toolName.startsWith('generate_')) return 'generate';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return 'write';
}

function isPendingToolStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'streaming' || status === 'validating' || status === 'processing' || status === 'working';
}

function toToolCallStatus(value: unknown): ToolCallStatus {
  const text = String(value ?? 'pending') as ToolCallStatus;
  if (
    text === 'streaming'
    || text === 'validating'
    || text === 'pending'
    || text === 'processing'
    || text === 'working'
    || text === 'failed'
    || text === 'rejected'
    || text === 'applied'
  ) {
    return text;
  }
  return 'pending';
}

function isReasoningDetailType(value: unknown): value is ReasoningDetail['type'] {
  return typeof value === 'string' && value.trim().length > 0;
}

function pickExistingReasoningDetail(message: ThreadMessage): ReasoningDetail | undefined {
  if (message.streamingData?.reasoningDetail) return message.streamingData.reasoningDetail;
  for (const entry of Object.values(message.data ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    const detail = (entry as { reasoningDetail?: ReasoningDetail }).reasoningDetail;
    if (detail && typeof detail === 'object') return detail;
  }
  return undefined;
}

function readOptionalIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function deriveStreamKey(payload: Record<string, unknown>): string | null {
  const explicit = readNonEmptyString(payload.stream_key);
  if (explicit) return explicit;

  const toolCallId = readNonEmptyString(payload.tool_call_id);
  if (toolCallId) return `legacy:id:${toolCallId}`;

  const index = readOptionalIndex(payload.index);
  if (index !== null) return `legacy:index:${index}`;

  return null;
}

function readRequestId(payload: Record<string, unknown>): string | null {
  return readNonEmptyString(payload.request_id);
}

function buildSessionKey(threadId: string, requestId: string): string {
  return `${threadId}:${requestId}`;
}

export class ThreadEventConsumer {
  private readonly streamingToolCallsBySession = new Map<string, Map<string, string>>();
  private readonly streamingArgBuffers = new Map<string, string>();
  private readonly autoContinueLockByThread = new Set<string>();
  private readonly inFlightResumeByThread = new Set<string>();
  private readonly autoAcceptLockByThread = new Set<string>();
  private readonly autoContinuedAssistantByThread = new Map<string, string>();
  private readonly deltaBuffer = new Map<string, Map<string, {
    threadId: string;
    runId: string;
    textDelta: string;
    thinkingDeltas: Array<{ text: string; thinkingDisplay: string }>;
  }>>();
  private deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DELTA_FLUSH_INTERVAL_MS = 80;
  private disposed = false;

  constructor() {}

  dispose(): void {
    this.disposed = true;
    if (this.deltaFlushTimer !== null) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    this.deltaBuffer.clear();
    this.streamingToolCallsBySession.clear();
    this.streamingArgBuffers.clear();
    this.autoContinueLockByThread.clear();
    this.inFlightResumeByThread.clear();
    this.autoAcceptLockByThread.clear();
    this.autoContinuedAssistantByThread.clear();
  }

  private ensureThread(threadId: string, partial?: Partial<ThreadInfo>): void {
    const store = useThreadStore.getState();
    const existing = store.threadsById[threadId];
    if (existing) {
      if (partial) store.patchThread(threadId, partial);
      return;
    }
    const projectId = partial?.projectId;
    if (!projectId) return;

    store.upsertThread({
      id: threadId,
      projectId,
      threadType: toThreadType(String(partial?.threadType ?? 'agent')),
      parentId: null,
      journeyKind: null,
      displayLabel: partial?.displayLabel ?? null,
      status: partial?.status ?? 'running',
      lastError: partial?.lastError ?? null,
      updatedAt: partial?.updatedAt ?? nowIso(),
      latestRunId: partial?.latestRunId ?? null,
      latestRunStatus: partial?.latestRunStatus ?? null,
      latestMessageAt: partial?.latestMessageAt ?? null,
      unresolvedToolCallCount: partial?.unresolvedToolCallCount ?? 0,
    });
  }

  private ensureAssistantMessage(params: {
    threadId: string;
    messageId: string;
    runId: string;
    seq?: number;
    seqInThread?: number;
  }): ThreadMessage {
    const store = useThreadStore.getState();
    const existing = store.getMessages(params.threadId).find((m) => m.id === params.messageId);
    if (existing) return existing;

    const message: ThreadMessage = {
      id: params.messageId,
      threadId: params.threadId,
      runId: params.runId,
      role: 'assistant',
      seq: params.seq ?? 0,
      seqInThread: params.seqInThread ?? 0,
      data: {},
      attachments: [],
      streamingData: {
        contentParts: [],
      },
      isStreaming: true,
      createdAt: nowIso(),
    };
    store.upsertMessage(message);
    return message;
  }

  private getStreamingToolMap(sessionKey: string): Map<string, string> {
    const existing = this.streamingToolCallsBySession.get(sessionKey);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.streamingToolCallsBySession.set(sessionKey, created);
    return created;
  }

  private rekeyStreamingTool(sessionKey: string, fromKey: string, toKey: string, tempId: string): void {
    if (fromKey === toKey) return;
    const toolMap = this.getStreamingToolMap(sessionKey);
    if (toolMap.get(fromKey) === tempId) {
      toolMap.delete(fromKey);
    }
    toolMap.set(toKey, tempId);
  }

  private resolveStreamingTempId(
    sessionKey: string,
    payload: Record<string, unknown>,
  ): { streamKey: string | null; tempId: string | null } {
    const toolMap = this.getStreamingToolMap(sessionKey);
    const desiredKey = deriveStreamKey(payload);
    if (desiredKey) {
      const direct = toolMap.get(desiredKey);
      if (direct) return { streamKey: desiredKey, tempId: direct };
    }

    const store = useThreadStore.getState();
    const llmCallId = readNonEmptyString(payload.tool_call_id);
    if (llmCallId) {
      for (const [existingKey, tempId] of toolMap) {
        const existing = store.toolCallsById[tempId];
        if (!existing || existing.llmCallId !== llmCallId) continue;
        if (desiredKey) {
          this.rekeyStreamingTool(sessionKey, existingKey, desiredKey, tempId);
          return { streamKey: desiredKey, tempId };
        }
        return { streamKey: existingKey, tempId };
      }
    }

    const index = readOptionalIndex(payload.index);
    const assistantMessageId = readNonEmptyString(payload.assistant_message_id);
    if (index !== null) {
      for (const [existingKey, tempId] of toolMap) {
        const existing = store.toolCallsById[tempId];
        if (!existing || existing.callSeq !== index) continue;
        if (assistantMessageId && existing.assistantMessageId !== assistantMessageId) continue;
        if (desiredKey) {
          this.rekeyStreamingTool(sessionKey, existingKey, desiredKey, tempId);
          return { streamKey: desiredKey, tempId };
        }
        return { streamKey: existingKey, tempId };
      }
    }

    return { streamKey: desiredKey, tempId: null };
  }

  private resolveStreamingTempIdForThread(
    threadId: string,
    payload: Record<string, unknown>,
  ): { sessionKey: string | null; streamKey: string | null; tempId: string | null } {
    const requestId = readRequestId(payload);
    if (requestId) {
      const sessionKey = buildSessionKey(threadId, requestId);
      const resolved = this.resolveStreamingTempId(sessionKey, payload);
      return { sessionKey, streamKey: resolved.streamKey, tempId: resolved.tempId };
    }

    for (const [sessionKey] of this.streamingToolCallsBySession) {
      if (!sessionKey.startsWith(`${threadId}:`)) continue;
      const resolved = this.resolveStreamingTempId(sessionKey, payload);
      if (resolved.tempId) {
        return { sessionKey, streamKey: resolved.streamKey, tempId: resolved.tempId };
      }
    }

    return { sessionKey: null, streamKey: deriveStreamKey(payload), tempId: null };
  }

  private patchThreadFromRunStatus(threadId: string, status: ThreadStatus, error: string | null, payload: Record<string, unknown>): void {
    const store = useThreadStore.getState();
    const existing = store.threadsById[threadId];
    const projectId = payload.project_id ? String(payload.project_id) : existing?.projectId;
    const partial: Partial<ThreadInfo> = {
      status,
      lastError: error,
      updatedAt: String(payload.ts ?? nowIso()),
      latestRunId: payload.run_id ? String(payload.run_id) : null,
      latestRunStatus: status,
      ...(payload.display_label ? { displayLabel: String(payload.display_label) } : {}),
    };

    if (!existing) {
      if (!projectId) return;
      store.upsertThread({
        id: threadId,
        projectId,
        threadType: toThreadType(String(payload.thread_type ?? 'agent')),
        parentId: null,
        journeyKind: null,
        displayLabel: payload.display_label ? String(payload.display_label) : null,
        status,
        lastError: error,
        updatedAt: String(payload.ts ?? nowIso()),
        latestRunId: payload.run_id ? String(payload.run_id) : null,
        latestRunStatus: status,
        latestMessageAt: null,
        unresolvedToolCallCount: 0,
      });
      return;
    }

    store.setThreadRuntime(threadId, partial);
  }

  private isSuppressed(threadId: string): boolean {
    const state = useThreadStore.getState();
    const thread = state.threadsById[threadId];
    return state.isPreexistingLiveThread(threadId) && isLiveThreadStatus(thread?.status);
  }

  private appendDelta(params: {
    threadId: string;
    messageId: string;
    runId: string;
    text: string;
  }): void {
    const store = useThreadStore.getState();
    const message = this.ensureAssistantMessage({
      threadId: params.threadId,
      messageId: params.messageId,
      runId: params.runId,
    });
    if (!message.isStreaming) return; // Already finalized (e.g. hydrated from API); skip replayed deltas
    const streaming = message.streamingData ?? { contentParts: [] };
    const parts = [...(streaming.contentParts ?? [])];
    const last = parts[parts.length - 1];
    if (last && last.type === 'content') {
      parts[parts.length - 1] = { type: 'content', text: last.text + params.text };
    } else {
      parts.push({ type: 'content', text: params.text });
    }
    store.patchMessage(params.threadId, params.messageId, {
      streamingData: {
        contentParts: parts,
        reasoningDetail: streaming.reasoningDetail,
      },
      isStreaming: true,
    });
    store.setThreadStreamActive(params.threadId, true);
  }

  private appendThinkingDelta(params: {
    threadId: string;
    messageId: string;
    runId: string;
    text: string;
    thinkingDisplay: string;
  }): void {
    const store = useThreadStore.getState();
    const message = this.ensureAssistantMessage({
      threadId: params.threadId,
      messageId: params.messageId,
      runId: params.runId,
    });
    if (!message.isStreaming) return;

    const streaming = message.streamingData ?? { contentParts: [] };
    const existing = pickExistingReasoningDetail(message);
    const type = isReasoningDetailType(existing?.type) ? existing.type : 'custom';
    const previousData = existing?.data && typeof existing.data === 'object'
      ? existing.data as Record<string, unknown>
      : {};
    const currentText = getByDotPath(previousData, params.thinkingDisplay);
    const nextText = `${typeof currentText === 'string' ? currentText : ''}${params.text}`;
    const data = setByDotPath(previousData, params.thinkingDisplay, nextText);

    const reasoningDetail: ReasoningDetail = {
      type,
      meta: {
        ...(existing?.meta ?? {}),
        thinking_display: params.thinkingDisplay,
      },
      data,
      token_count: typeof existing?.token_count === 'number' ? existing.token_count : 0,
    };

    store.patchMessage(params.threadId, params.messageId, {
      streamingData: {
        contentParts: streaming.contentParts ?? [],
        reasoningDetail,
      },
      isStreaming: true,
    });
    store.setThreadStreamActive(params.threadId, true);
  }

  private bufferDelta(threadId: string, requestId: string, messageId: string, runId: string, text: string): void {
    const sessionKey = buildSessionKey(threadId, requestId);
    let threadMap = this.deltaBuffer.get(sessionKey);
    if (!threadMap) {
      threadMap = new Map();
      this.deltaBuffer.set(sessionKey, threadMap);
    }
    let entry = threadMap.get(messageId);
    if (!entry) {
      entry = { threadId, runId, textDelta: '', thinkingDeltas: [] };
      threadMap.set(messageId, entry);
    }
    entry.textDelta += text;
    this.scheduleDeltaFlush();
  }

  private bufferThinkingDelta(
    threadId: string, requestId: string, messageId: string, runId: string,
    text: string, thinkingDisplay: string,
  ): void {
    const sessionKey = buildSessionKey(threadId, requestId);
    let threadMap = this.deltaBuffer.get(sessionKey);
    if (!threadMap) {
      threadMap = new Map();
      this.deltaBuffer.set(sessionKey, threadMap);
    }
    let entry = threadMap.get(messageId);
    if (!entry) {
      entry = { threadId, runId, textDelta: '', thinkingDeltas: [] };
      threadMap.set(messageId, entry);
    }
    entry.thinkingDeltas.push({ text, thinkingDisplay });
    this.scheduleDeltaFlush();
  }

  private scheduleDeltaFlush(): void {
    if (this.deltaFlushTimer !== null) return;
    this.deltaFlushTimer = setTimeout(() => {
      this.deltaFlushTimer = null;
      this.flushDeltaBuffer();
    }, ThreadEventConsumer.DELTA_FLUSH_INTERVAL_MS);
  }

  private flushDeltaBuffer(): void {
    if (this.disposed) return;
    const snapshot = new Map(this.deltaBuffer);
    this.deltaBuffer.clear();

    for (const [, messageMap] of snapshot) {
      for (const [messageId, entry] of messageMap) {
        if (entry.textDelta) {
          this.appendDelta({
            threadId: entry.threadId,
            messageId,
            runId: entry.runId,
            text: entry.textDelta,
          });
        }
        for (const td of entry.thinkingDeltas) {
          this.appendThinkingDelta({
            threadId: entry.threadId,
            messageId,
            runId: entry.runId,
            text: td.text,
            thinkingDisplay: td.thinkingDisplay,
          });
        }
      }
    }
  }

  private refreshUnresolvedCount(threadId: string): void {
    const state = useThreadStore.getState();
    let count = 0;
    for (const toolCall of Object.values(state.toolCallsById)) {
      if (!toolCall || toolCall.threadId !== threadId) continue;
      if (isPendingToolStatus(toolCall.status)) count += 1;
    }
    state.setThreadRuntime(threadId, {
      unresolvedToolCallCount: count,
      updatedAt: nowIso(),
    });
  }

  private clearThreadStreamingState(threadId: string): void {
    for (const [sessionKey, toolMap] of [...this.streamingToolCallsBySession.entries()]) {
      if (!sessionKey.startsWith(`${threadId}:`)) continue;
      for (const tempId of toolMap.values()) {
        this.streamingArgBuffers.delete(tempId);
      }
      this.streamingToolCallsBySession.delete(sessionKey);
    }
    for (const sessionKey of [...this.deltaBuffer.keys()]) {
      if (sessionKey.startsWith(`${threadId}:`)) {
        this.deltaBuffer.delete(sessionKey);
      }
    }
  }

  private clearStreamingSession(sessionKey: string): void {
    const toolMap = this.streamingToolCallsBySession.get(sessionKey);
    if (toolMap) {
      for (const tempId of toolMap.values()) {
        this.streamingArgBuffers.delete(tempId);
      }
    }
    this.streamingToolCallsBySession.delete(sessionKey);
    this.deltaBuffer.delete(sessionKey);
  }

  private clearStreamingAssistantBuffers(threadId: string, assistantMessageId: string): void {
    const assistantToken = `:${assistantMessageId}:`;
    for (const [sessionKey, toolMap] of [...this.streamingToolCallsBySession.entries()]) {
      if (!sessionKey.startsWith(`${threadId}:`)) continue;
      for (const [streamKey, tempId] of [...toolMap.entries()]) {
        if (!tempId.includes(assistantToken)) continue;
        toolMap.delete(streamKey);
        this.streamingArgBuffers.delete(tempId);
      }
      if (toolMap.size === 0) {
        this.streamingToolCallsBySession.delete(sessionKey);
      }
    }
    for (const [sessionKey, messageMap] of [...this.deltaBuffer.entries()]) {
      if (!sessionKey.startsWith(`${threadId}:`)) continue;
      messageMap.delete(assistantMessageId);
      if (messageMap.size === 0) {
        this.deltaBuffer.delete(sessionKey);
      }
    }
  }

  private handleToolCallStart(threadId: string, payload: Record<string, unknown>): void {
    const requestId = readRequestId(payload);
    if (!requestId) return;
    const streamKey = deriveStreamKey(payload);
    if (!streamKey) return;
    const index = readOptionalIndex(payload.index);
    const assistantMessageId = payload.assistant_message_id ? String(payload.assistant_message_id) : '';
    const sessionKey = buildSessionKey(threadId, requestId);
    const toolMap = this.getStreamingToolMap(sessionKey);
    const existingTempId = toolMap.get(streamKey);
    if (existingTempId) return;
    const tempId = `streaming:${threadId}:${requestId}:${assistantMessageId}:${streamKey}`;
    toolMap.set(streamKey, tempId);

    const toolCall: ThreadToolCall = {
      id: tempId,
      threadId,
      runId: payload.run_id ? String(payload.run_id) : '',
      messageId: String(payload.message_id ?? ''),
      assistantMessageId: assistantMessageId || null,
      callSeq: index ?? 0,
      llmCallId: String(payload.tool_call_id ?? ''),
      toolName: String(payload.name ?? ''),
      arguments: {},
      status: 'streaming',
      reason: null,
      result: null,
      childThreadId: null,
      acceptedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    useThreadStore.getState().upsertToolCall(toolCall);
    this.refreshUnresolvedCount(threadId);
  }

  private handleToolCallDelta(threadId: string, payload: Record<string, unknown>): void {
    const { tempId } = this.resolveStreamingTempIdForThread(threadId, payload);
    if (!tempId) return;

    const store = useThreadStore.getState();
    const existing = store.toolCallsById[tempId];
    if (!existing) return;

    const argsDelta = String(payload.arguments_delta ?? '');
    const name = payload.name ? String(payload.name) : '';
    const prevRaw = this.streamingArgBuffers.get(tempId) ?? '';
    const nextRaw = prevRaw + argsDelta;
    this.streamingArgBuffers.set(tempId, nextRaw);

    let parsed: Record<string, unknown> = {};
    try {
      const obj = JSON.parse(nextRaw);
      if (typeof obj === 'object' && obj !== null) {
        parsed = obj as Record<string, unknown>;
      }
    } catch {
      // Keep empty until arguments JSON is complete.
    }

    const patch: Partial<ThreadToolCall> = { arguments: parsed, updatedAt: nowIso() };
    if (name) patch.toolName = name;
    if (payload.tool_call_id) patch.llmCallId = String(payload.tool_call_id);
    store.patchToolCall(tempId, patch);
  }

  private handleToolCallEnd(threadId: string, payload: Record<string, unknown>): void {
    const toolCallId = String(payload.tool_call_id ?? '');
    if (!toolCallId) return;

    const index = readOptionalIndex(payload.index);
    const { sessionKey, streamKey, tempId } = this.resolveStreamingTempIdForThread(threadId, payload);
    if (tempId) {
      useThreadStore.getState().removeToolCall(tempId);
      if (sessionKey && streamKey) {
        this.getStreamingToolMap(sessionKey).delete(streamKey);
      }
      this.streamingArgBuffers.delete(tempId);
    }

    const toolCall: ThreadToolCall = {
      id: toolCallId,
      threadId,
      runId: payload.run_id ? String(payload.run_id) : '',
      messageId: String(payload.message_id ?? ''),
      assistantMessageId: payload.assistant_message_id ? String(payload.assistant_message_id) : null,
      callSeq: index ?? 0,
      llmCallId: toolCallId,
      toolName: String(payload.name ?? ''),
      arguments: (payload.arguments ?? {}) as Record<string, unknown>,
      extraContent: (payload.extra_content ?? null) as Record<string, unknown> | null,
      status: toToolCallStatus(payload.status ?? 'validating'),
      reason: null,
      result: null,
      imageRunId: payload.image_run_id ? String(payload.image_run_id) : null,
      childThreadId: null,
      acceptedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const store = useThreadStore.getState();
    store.upsertToolCall(toolCall);

    const toolCallMessageId = String(payload.message_id ?? '');
    if (toolCallMessageId) {
      store.upsertMessage({
        id: toolCallMessageId,
        threadId,
        runId: toolCall.runId,
        role: 'tool_call',
        seq: 0,
        seqInThread: Number(payload.seq_in_thread ?? 0),
        data: {},
        attachments: [],
        isStreaming: false,
        createdAt: nowIso(),
      });
    }

    this.refreshUnresolvedCount(threadId);
  }

  private applyToolDecisionResponse(response: ToolCallDecisionResponse): void {
    const store = useThreadStore.getState();
    store.upsertToolCall(response.toolCall);
    this.refreshUnresolvedCount(response.toolCall.threadId);
  }

  private getAutoApproveConfig(): AutoApproveConfig | null {
    try {
      return useSettingsStore.getState().getSettings().toolCallAutoApprove;
    } catch {
      return null;
    }
  }

  private isToolAutoApprovable(toolCall: ThreadToolCall, config: AutoApproveConfig): boolean {
    const category = getToolCategory(toolCall);
    return category !== null && Boolean(config[category]);
  }

  private async tryAutoAcceptForAssistant(threadId: string, assistantMessageId: string): Promise<void> {
    if (this.autoAcceptLockByThread.has(threadId)) return;
    const config = this.getAutoApproveConfig();
    if (!config) return;

    const store = useThreadStore.getState();
    const toolCalls = store.getToolCallsForAssistantMessage(assistantMessageId);
    const pending = toolCalls.filter((tc) => tc.status === 'pending');
    if (pending.length === 0) return;

    const allAllowed = pending.every((tc) => this.isToolAutoApprovable(tc, config));
    if (!allAllowed) return;

    this.autoAcceptLockByThread.add(threadId);
    try {
      const response = await threadService.decideToolCallsBatch(threadId, {
        decisions: pending.map((tc) => ({ tool_call_id: tc.id, decision: 'accept' })),
      });
      response.results.forEach((item) => this.applyToolDecisionResponse(item));
    } finally {
      this.autoAcceptLockByThread.delete(threadId);
    }
  }

  private async checkAutoContinue(threadId: string): Promise<void> {
    if (this.autoContinueLockByThread.has(threadId)) {
      console.debug('[AutoContinue] Skipped: lock held', { threadId });
      return;
    }
    this.autoContinueLockByThread.add(threadId);
    try {
      const store = useThreadStore.getState();
      const thread = store.threadsById[threadId];
      const latestRunId = thread?.latestRunId ?? null;
      const messages = store.getMessages(threadId);
      const latestAssistant = [...messages]
        .sort((a, b) => b.seqInThread - a.seqInThread)
        .find((m) => m.role === 'assistant');
      if (!latestAssistant) {
        console.debug('[AutoContinue] Skipped: no assistant message', { threadId });
        return;
      }

      // Ignore stale assistants from older runs.
      if (latestRunId && latestAssistant.runId && latestAssistant.runId !== latestRunId) {
        console.debug('[AutoContinue] Skipped: stale assistant from older run', { threadId, latestRunId, assistantRunId: latestAssistant.runId });
        return;
      }

      // Prevent repeated auto-continue on the same assistant message.
      if (this.autoContinuedAssistantByThread.get(threadId) === latestAssistant.id) {
        console.debug('[AutoContinue] Skipped: already continued for this assistant', { threadId, assistantId: latestAssistant.id });
        return;
      }

      const toolCalls = store.getToolCallsForAssistantMessage(latestAssistant.id);
      if (toolCalls.length === 0) {
        console.debug('[AutoContinue] Skipped: no tool calls for assistant', { threadId, assistantId: latestAssistant.id });
        return;
      }

      if (!toolCalls.every((tc) => tc.status === 'applied' || tc.status === 'failed')) {
        console.debug('[AutoContinue] Skipped: unresolved tool calls', { threadId, statuses: toolCalls.map((tc) => tc.status) });
        return;
      }

      const unresolvedCount = Number(thread?.unresolvedToolCallCount ?? 0);
      if (unresolvedCount > 0) {
        console.debug('[AutoContinue] Skipped: thread has unresolved tool calls', { threadId, unresolvedCount });
        return;
      }

      // Tool-call resolution above is the authoritative auto-continue signal.
      // The thread status can lag behind SSE/hydration, so only block active or explicit pause states.
      if (thread?.status === 'running' || thread?.status === 'paused') {
        console.debug('[AutoContinue] Skipped: thread is not auto-continuable', { threadId, status: thread?.status });
        return;
      }

      if (this.inFlightResumeByThread.has(threadId)) {
        console.debug('[AutoContinue] Skipped: resume already in-flight', { threadId });
        return;
      }
      this.inFlightResumeByThread.add(threadId);
      try {
        console.debug('[AutoContinue] Resuming parent thread', { threadId, assistantId: latestAssistant.id, toolCallCount: toolCalls.length });
        const response = await threadService.resumeRun(threadId);
        this.autoContinuedAssistantByThread.set(threadId, latestAssistant.id);
        store.setThreadRuntime(threadId, {
          status: response.threadStatus,
          latestRunId: response.runId,
          latestRunStatus: response.status,
          updatedAt: nowIso(),
        });
      } catch (err) {
        console.error('[AutoContinue] Resume failed, will retry on next event', { threadId, error: err });
      } finally {
        this.inFlightResumeByThread.delete(threadId);
      }
    } finally {
      this.autoContinueLockByThread.delete(threadId);
    }
  }

  async consume(event: ThreadRuntimeEvent): Promise<void> {
    if (this.disposed) return;
    const payload = (event.data ?? {}) as Record<string, unknown>;

    if (event.event === 'thread:delete') {
      const threadId = payload.id ? String(payload.id) : '';
      if (!threadId) return;
      useThreadStore.getState().removeThreadCascade(threadId);
      useJourneyStore.getState().clearByThreadId(threadId);
      this.clearThreadStreamingState(threadId);
      this.autoContinueLockByThread.delete(threadId);
      this.inFlightResumeByThread.delete(threadId);
      this.autoAcceptLockByThread.delete(threadId);
      this.autoContinuedAssistantByThread.delete(threadId);
      return;
    }

    if (event.event === 'thread:bulk_delete') {
      const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => String(id)).filter(Boolean) : [];
      if (ids.length === 0) return;
      useThreadStore.getState().removeThreadsCascade(ids);
      useJourneyStore.getState().clearByThreadIds(ids);
      for (const threadId of ids) {
        this.clearThreadStreamingState(threadId);
        this.autoContinueLockByThread.delete(threadId);
        this.inFlightResumeByThread.delete(threadId);
        this.autoAcceptLockByThread.delete(threadId);
        this.autoContinuedAssistantByThread.delete(threadId);
      }
      return;
    }

    const threadId = payload.thread_id ? String(payload.thread_id) : '';
    if (!threadId) return;

    const threadPartial: Partial<ThreadInfo> = {
      latestRunId: payload.run_id ? String(payload.run_id) : null,
      ...(payload.project_id ? { projectId: String(payload.project_id) } : {}),
    };
    if (payload.thread_type) {
      threadPartial.threadType = toThreadType(String(payload.thread_type));
    }
    if (payload.display_label) {
      threadPartial.displayLabel = String(payload.display_label);
    }
    this.ensureThread(threadId, threadPartial);

    if (event.event === 'thread:snapshot_invalidated') {
      void fetchAndReplaceThreadSnapshot(threadId);
      return;
    }

    if (event.event === 'run:stage') {
      const stage = typeof payload.stage === 'string' ? payload.stage : null;
      if (!stage) return;
      useThreadStore.getState().setThreadStage(threadId, stage);
      return;
    }

    if (event.event === 'llm:request') {
      const d = event.data as Record<string, unknown>;
      const retryCount = typeof d.retry_count === 'number' ? d.retry_count : Number(d.retry_count ?? 0);
      if (Number.isFinite(retryCount) && retryCount > 0) {
        useThreadStore.getState().setThreadStage(threadId, 'retrying');
      }
      const runId = d.run_id ? String(d.run_id) : 'n/a';
      const requestId = d.request_id ? String(d.request_id) : 'n/a';
      console.groupCollapsed(
        `%c[LLM Request]%c run=${runId} · request=${requestId} · ${d.provider}/${d.model}`,
        'color: var(--color-brand-primary); font-weight: bold',
        'color: inherit',
      );
      if (d.retry_count !== undefined) {
        console.log('Retry Count:', d.retry_count);
      }
      console.groupEnd();
      return;
    }

    if (event.event === 'llm:response') {
      const d = event.data as Record<string, unknown>;
      const runId = d.run_id ? String(d.run_id) : 'n/a';
      const requestId = d.request_id ? String(d.request_id) : 'n/a';
      console.groupCollapsed(
        `%c[LLM Response]%c run=${runId} · request=${requestId} · ${d.provider}/${d.model}`,
        'color: var(--color-success); font-weight: bold',
        'color: inherit',
      );
      console.groupEnd();
      return;
    }

    if (event.event === 'run:status') {
      const status = String(payload.status ?? 'running') as ThreadStatus;
      const error = payload.error ? String(payload.error) : null;
      this.patchThreadFromRunStatus(threadId, status, error, payload);
      if (isNonLiveThreadStatus(status)) {
        useThreadStore.getState().setThreadStreamActive(threadId, false);
        useThreadStore.getState().setThreadStage(threadId, null);
      }
      if (isNonLiveThreadStatus(status) && useThreadStore.getState().isPreexistingLiveThread(threadId)) {
        void fetchAndReplaceThreadSnapshot(threadId);
      }
      this.refreshUnresolvedCount(threadId);
      void this.checkAutoContinue(threadId);
      return;
    }

    if (event.event === 'message:user') {
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      if (!messageId || !runId) return;

      const store = useThreadStore.getState();
      const existing = store.getMessages(threadId);
      for (const message of existing) {
        if (message.id.startsWith('optimistic:user:') && message.role === 'user') {
          revokeMessageAttachmentObjectUrls(message);
          store.removeMessage(threadId, message.id);
        }
      }

      store.upsertMessage({
        id: messageId,
        threadId,
        runId,
        role: 'user',
        seq: Number(payload.seq ?? 0),
        seqInThread: Number(payload.seq_in_thread ?? 0),
        data: (payload.data ?? {}) as ThreadMessage['data'],
        attachments: Array.isArray(payload.attachments)
          ? payload.attachments.map((item) => toMessageAttachment(item))
          : [],
        isStreaming: false,
        createdAt: nowIso(),
      });
      return;
    }

    if (event.event === 'message:start') {
      if (this.isSuppressed(threadId)) return;
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      if (!messageId || !runId) return;
      this.ensureAssistantMessage({
        threadId,
        messageId,
        runId,
        seq: Number(payload.seq ?? 0),
        seqInThread: Number(payload.seq_in_thread ?? 0),
      });
      useThreadStore.getState().setThreadStreamActive(threadId, true);
      return;
    }

    if (event.event === 'content:delta') {
      useThreadStore.getState().setThreadStage(threadId, null);
      if (this.isSuppressed(threadId)) return;
      const requestId = readRequestId(payload);
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      const text = String(payload.text ?? '');
      if (!requestId || !messageId || !runId || !text) return;
      this.bufferDelta(threadId, requestId, messageId, runId, text);
      return;
    }

    if (event.event === 'thinking:delta') {
      if (this.isSuppressed(threadId)) return;
      const requestId = readRequestId(payload);
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      const text = String(payload.text ?? '');
      const thinkingDisplay = String(payload.thinking_display ?? '').trim();
      if (!requestId || !messageId || !runId || !text || !thinkingDisplay) return;
      this.bufferThinkingDelta(threadId, requestId, messageId, runId, text, thinkingDisplay);
      return;
    }

    if (event.event === 'tool_call:start') {
      if (this.isSuppressed(threadId)) return;
      this.handleToolCallStart(threadId, payload);
      return;
    }

    if (event.event === 'tool_call:delta') {
      if (this.isSuppressed(threadId)) return;
      this.handleToolCallDelta(threadId, payload);
      return;
    }

    if (event.event === 'tool_call:end') {
      this.handleToolCallEnd(threadId, payload);
      return;
    }

    if (event.event === 'tool_call:status') {
      const toolCallId = String(payload.tool_call_id ?? '');
      if (!toolCallId) return;

      const store = useThreadStore.getState();
      const existing = store.toolCallsById[toolCallId];
      const childThreadId = payload.child_thread_id ? String(payload.child_thread_id) : null;
      const assistantMsgId = payload.assistant_message_id ? String(payload.assistant_message_id) : null;
      if (!existing) {
        store.upsertToolCall({
          id: toolCallId,
          threadId,
          runId: payload.run_id ? String(payload.run_id) : '',
          messageId: '',
          assistantMessageId: assistantMsgId,
          callSeq: 0,
          llmCallId: toolCallId,
          toolName: '',
          arguments: {},
          extraContent: (payload.extra_content ?? null) as Record<string, unknown> | null,
          status: toToolCallStatus(payload.status),
          reason: payload.reason ? String(payload.reason) : null,
          result: (payload.result ?? null) as Record<string, unknown> | null,
          imageRunId: payload.image_run_id ? String(payload.image_run_id) : null,
          childThreadId,
          acceptedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      } else if (assistantMsgId && !existing.assistantMessageId) {
        // Re-index via upsertToolCall when recovering a missing assistantMessageId
        store.upsertToolCall({
          ...existing,
          status: toToolCallStatus(payload.status),
          extraContent: (payload.extra_content ?? existing.extraContent ?? null) as Record<string, unknown> | null,
          reason: payload.reason ? String(payload.reason) : null,
          result: (payload.result ?? null) as Record<string, unknown> | null,
          imageRunId: payload.image_run_id ? String(payload.image_run_id) : existing.imageRunId ?? null,
          assistantMessageId: assistantMsgId,
          childThreadId: childThreadId ?? existing.childThreadId,
          updatedAt: nowIso(),
        });
      } else {
        const patch: Partial<ThreadToolCall> = {
          status: toToolCallStatus(payload.status),
          extraContent: (payload.extra_content ?? existing.extraContent ?? null) as Record<string, unknown> | null,
          reason: payload.reason ? String(payload.reason) : null,
          result: (payload.result ?? null) as Record<string, unknown> | null,
          imageRunId: payload.image_run_id ? String(payload.image_run_id) : existing.imageRunId ?? null,
          updatedAt: nowIso(),
        };
        if (childThreadId) patch.childThreadId = childThreadId;
        store.patchToolCall(toolCallId, patch);
      }

      if (childThreadId) {
        const parentThread = store.threadsById[threadId];
        const projectId = readNonEmptyString(payload.project_id) ?? parentThread?.projectId;
        this.ensureThread(childThreadId, {
          ...(projectId ? { projectId } : {}),
          threadType: 'subAgent',
          updatedAt: nowIso(),
        });
      }

      this.refreshUnresolvedCount(threadId);
      await this.checkAutoContinue(threadId);
      return;
    }

    if (event.event === 'message:update') {
      const store = useThreadStore.getState();
      const messageId = String(payload.message_id ?? '');
      if (!messageId) return;
      const existing = store.getMessages(threadId).find((m) => m.id === messageId);
      if (!existing) return;

      const patchData = (payload.data ?? {}) as ThreadMessage['data'];

      // Only merge language entries that carry actual content so that empty
      // entries coming from the backend don't blank out existing data.
      const filtered: ThreadMessage['data'] = {};
      for (const [lang, entry] of Object.entries(patchData)) {
        if (!entry || typeof entry !== 'object') continue;
        const hasParts = Array.isArray(entry.contentParts) && entry.contentParts.length > 0;
        const hasReasoning = entry.reasoningDetail !== undefined;
        if (hasParts || hasReasoning) {
          filtered[lang] = entry;
        }
      }

      if (Object.keys(filtered).length > 0) {
        store.patchMessage(threadId, messageId, {
          data: {
            ...(existing.data ?? {}),
            ...filtered,
          },
        });
      }
      store.setThreadRuntime(threadId, {
        latestMessageAt: payload.ts ? String(payload.ts) : nowIso(),
        updatedAt: payload.ts ? String(payload.ts) : nowIso(),
      });
      return;
    }

    if (event.event === 'message:end') {
      this.flushDeltaBuffer();
      const store = useThreadStore.getState();
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      if (!messageId || !runId) return;

      store.finalizeMessageFromEnd({
        threadId,
        messageId,
        runId,
        seqInThread: Number(payload.seq_in_thread ?? 0),
        data: (payload.data ?? {}) as ThreadMessage['data'],
        ts: payload.ts ? String(payload.ts) : nowIso(),
      });

      // message:end is the authoritative final state. Wipe all existing
      // tool calls for this assistant message and replace with the payload
      // in a single batched store update to avoid per-item re-renders.
      const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls as Record<string, unknown>[] : [];
      const requestId = readRequestId(payload);
      if (requestId) {
        this.clearStreamingSession(buildSessionKey(threadId, requestId));
      } else {
        this.clearStreamingAssistantBuffers(threadId, messageId);
      }

      const now = nowIso();
      const newToolCalls: ThreadToolCall[] = [];
      const newMessages: ThreadMessage[] = [];

      for (const tc of toolCalls) {
        const toolCallId = String(tc.tool_call_id ?? '');
        if (!toolCallId) continue;

        newToolCalls.push({
          id: toolCallId,
          threadId,
          runId,
          messageId: String(tc.message_id ?? ''),
          assistantMessageId: tc.assistant_message_id ? String(tc.assistant_message_id) : messageId,
          callSeq: Number(tc.index ?? 0),
          llmCallId: toolCallId,
          toolName: String(tc.name ?? ''),
          arguments: (tc.arguments ?? {}) as Record<string, unknown>,
          extraContent: (tc.extra_content ?? null) as Record<string, unknown> | null,
          status: toToolCallStatus(tc.status ?? 'validating'),
          reason: tc.reason ? String(tc.reason) : null,
          result: null,
          imageRunId: tc.image_run_id ? String(tc.image_run_id) : null,
          childThreadId: null,
          acceptedAt: null,
          createdAt: now,
          updatedAt: now,
        });

        const toolCallMessageId = String(tc.message_id ?? '');
        if (toolCallMessageId) {
          newMessages.push({
            id: toolCallMessageId,
            threadId,
            runId,
            role: 'tool_call',
            seq: 0,
            seqInThread: Number(tc.seq_in_thread ?? 0),
            data: {},
            attachments: [],
            isStreaming: false,
            createdAt: now,
          });
        }
      }

      // Batch: single store update for tool calls, single for messages
      store.replaceToolCallsForAssistant(messageId, newToolCalls);
      if (newMessages.length > 0) {
        store.upsertMessages(newMessages);
      }

      store.setThreadRuntime(threadId, {
        latestMessageAt: payload.ts ? String(payload.ts) : now,
        updatedAt: payload.ts ? String(payload.ts) : now,
      });

      // Fire-and-forget: don't block the event consumer with network calls.
      // tryAutoAccept must complete before checkAutoContinue can evaluate.
      this.tryAutoAcceptForAssistant(threadId, messageId).then(() => {
        this.refreshUnresolvedCount(threadId);
        this.checkAutoContinue(threadId);
      });
      return;
    }

    if (event.event === 'message:error') {
      this.flushDeltaBuffer();
      const messageId = String(payload.message_id ?? '');
      if (!messageId) return;
      const requestId = readRequestId(payload);
      if (requestId) {
        this.clearStreamingSession(buildSessionKey(threadId, requestId));
      }
      this.clearStreamingAssistantBuffers(threadId, messageId);
      const store = useThreadStore.getState();
      store.discardStreamingAssistantMessage(threadId, messageId);
      this.refreshUnresolvedCount(threadId);
      return;
    }

    if (event.event === 'run:done') {
      this.flushDeltaBuffer();
      const finalStatus = String(payload.final_status ?? 'done') as ThreadStatus;
      this.patchThreadFromRunStatus(threadId, finalStatus, null, payload);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
      if (useThreadStore.getState().isPreexistingLiveThread(threadId)) {
        void fetchAndReplaceThreadSnapshot(threadId);
      }
      this.refreshUnresolvedCount(threadId);
      void this.checkAutoContinue(threadId);
      return;
    }

    if (event.event === 'run:error') {
      this.flushDeltaBuffer();
      const error = String(payload.error ?? 'Unknown error');
      this.patchThreadFromRunStatus(threadId, 'error', error, payload);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
      if (useThreadStore.getState().isPreexistingLiveThread(threadId)) {
        void fetchAndReplaceThreadSnapshot(threadId);
      }
      return;
    }

    if (event.event === 'run:canceled') {
      this.flushDeltaBuffer();
      this.patchThreadFromRunStatus(threadId, 'canceled', null, payload);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
      useThreadStore.getState().clearThreadStreamingState(threadId);
      if (useThreadStore.getState().isPreexistingLiveThread(threadId)) {
        void fetchAndReplaceThreadSnapshot(threadId);
      }
    }
  }
}
