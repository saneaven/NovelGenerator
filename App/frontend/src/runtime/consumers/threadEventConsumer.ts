import type { ThreadRuntimeEvent } from '../../api/sseClient';
import { useJourneyStore } from '../../store/journeyStore';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import {
  refetchThreadSnapshot,
  readThreadSnapshotFromCache,
  removeThreadSnapshotFromCache,
  upsertSnapshotMessage,
  upsertSnapshotMessages,
  patchSnapshotMessage,
  removeSnapshotMessage,
  upsertSnapshotToolCall,
  patchSnapshotToolCall,
  removeSnapshotToolCall,
  replaceSnapshotToolCallsForAssistant,
  ensureStreamingMessageInCache,
  clearThreadStreamingCache,
  getMergedThreadView,
} from '../../data/threads';
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
import { toMessageAttachment, revokeMessageAttachmentObjectUrls } from '../../utils/threadAttachments';
import { acceptThreadEvent, takeThreadSnapshotEvents, setThreadSnapshotCursor, runtimeTimestamp } from '../threadReconciliation';

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

function hasMessageData(data: ThreadMessage['data'] | undefined): boolean {
  return Boolean(data && Object.keys(data).length > 0);
}

function fallbackDataFromStreaming(message: ThreadMessage | undefined): ThreadMessage['data'] | undefined {
  const streaming = message?.streamingData;
  if (!streaming) return undefined;
  const hasContentParts = Array.isArray(streaming.contentParts) && streaming.contentParts.length > 0;
  const hasReasoning = streaming.reasoningDetail !== undefined;
  if (!hasContentParts && !hasReasoning) return undefined;
  const preferLanguage = Object.keys(message.data ?? {})[0];
  const entry = {
    contentParts: streaming.contentParts ?? [],
    ...(streaming.reasoningDetail !== undefined
      ? { reasoningDetail: streaming.reasoningDetail }
      : {}),
  };
  return {
    ...(message.data ?? {}),
    [preferLanguage]: entry,
  };
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
  }

  private ensureThread(threadId: string, partial?: Partial<ThreadInfo>): void {
    const store = useThreadStreamStore.getState();
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
    threadId: string,
    sessionKey: string,
    payload: Record<string, unknown>,
  ): { streamKey: string | null; tempId: string | null } {
    const toolMap = this.getStreamingToolMap(sessionKey);
    const desiredKey = deriveStreamKey(payload);
    if (desiredKey) {
      const direct = toolMap.get(desiredKey);
      if (direct) return { streamKey: desiredKey, tempId: direct };
    }

    const toolCalls = readThreadSnapshotFromCache(threadId).toolCalls;
    const findTemp = (tempId: string): ThreadToolCall | undefined => toolCalls.find((tc) => tc.id === tempId);
    const llmCallId = readNonEmptyString(payload.tool_call_id);
    if (llmCallId) {
      for (const [existingKey, tempId] of toolMap) {
        const existing = findTemp(tempId);
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
        const existing = findTemp(tempId);
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
      const resolved = this.resolveStreamingTempId(threadId, sessionKey, payload);
      return { sessionKey, streamKey: resolved.streamKey, tempId: resolved.tempId };
    }

    for (const [sessionKey] of this.streamingToolCallsBySession) {
      if (!sessionKey.startsWith(`${threadId}:`)) continue;
      const resolved = this.resolveStreamingTempId(threadId, sessionKey, payload);
      if (resolved.tempId) {
        return { sessionKey, streamKey: resolved.streamKey, tempId: resolved.tempId };
      }
    }

    return { sessionKey: null, streamKey: deriveStreamKey(payload), tempId: null };
  }

  private patchThreadFromRunStatus(threadId: string, status: ThreadStatus, error: string | null, payload: Record<string, unknown>): void {
    const store = useThreadStreamStore.getState();
    const existing = store.threadsById[threadId];
    const projectId = payload.project_id ? String(payload.project_id) : existing?.projectId;
    const partial: Partial<ThreadInfo> = {
      status,
      ...(payload.run_seq != null ? { latestRunSeq: Number(payload.run_seq) } : {}),
      ...(payload.run_updated_at ? { latestRunUpdatedAt: String(payload.run_updated_at) } : {}),
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
    const state = useThreadStreamStore.getState();
    const thread = state.threadsById[threadId];
    return state.isPreexistingLiveThread(threadId) && isLiveThreadStatus(thread?.status);
  }

  private appendDelta(params: {
    threadId: string;
    messageId: string;
    runId: string;
    text: string;
  }): void {
    const message = ensureStreamingMessageInCache(params.threadId, params.messageId, params.runId);
    if (!message) return; // Already finalized (e.g. hydrated from API); skip replayed deltas
    const streaming = message.streamingData ?? { contentParts: [] };
    const parts = [...(streaming.contentParts ?? [])];
    const last = parts[parts.length - 1];
    if (last && last.type === 'content') {
      parts[parts.length - 1] = { type: 'content', text: last.text + params.text };
    } else {
      parts.push({ type: 'content', text: params.text });
    }
    patchSnapshotMessage(params.threadId, params.messageId, {
      streamingData: {
        contentParts: parts,
        reasoningDetail: streaming.reasoningDetail,
      },
      isStreaming: true,
    });
    useThreadStreamStore.getState().setThreadStreamActive(params.threadId, true);
  }

  private appendThinkingDelta(params: {
    threadId: string;
    messageId: string;
    runId: string;
    text: string;
    thinkingDisplay: string;
  }): void {
    const message = ensureStreamingMessageInCache(params.threadId, params.messageId, params.runId);
    if (!message) return;

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

    patchSnapshotMessage(params.threadId, params.messageId, {
      streamingData: {
        contentParts: streaming.contentParts ?? [],
        reasoningDetail,
      },
      isStreaming: true,
    });
    useThreadStreamStore.getState().setThreadStreamActive(params.threadId, true);
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
    const view = getMergedThreadView(threadId);
    let count = 0;
    for (const toolCall of Object.values(view.toolCallsById)) {
      if (!toolCall) continue;
      if (isPendingToolStatus(toolCall.status)) count += 1;
    }
    useThreadStreamStore.getState().setThreadRuntime(threadId, {
      unresolvedToolCallCount: count,
      updatedAt: nowIso(),
    });
  }

  /** message:end — convert the live streaming assistant message into finalized snapshot truth. */
  private finalizeAssistantMessage(params: {
    threadId: string;
    messageId: string;
    runId: string;
    seqInThread?: number;
    data?: ThreadMessage['data'];
    ts?: string;
  }): void {
    const existing = readThreadSnapshotFromCache(params.threadId).messages.find((m) => m.id === params.messageId);
    const fallbackData = fallbackDataFromStreaming(existing);
    const finalData = hasMessageData(params.data)
      ? params.data!
      : (fallbackData ?? existing?.data ?? {});

    const finalized: ThreadMessage = existing
      ? {
          ...existing,
          runId: params.runId,
          data: finalData,
          seqInThread: Number(params.seqInThread ?? existing.seqInThread ?? 0),
          streamingData: undefined,
          isStreaming: false,
        }
      : {
          id: params.messageId,
          threadId: params.threadId,
          runId: params.runId,
          role: 'assistant',
          seq: 0,
          seqInThread: Number(params.seqInThread ?? 0),
          data: finalData,
          attachments: [],
          streamingData: undefined,
          isStreaming: false,
          createdAt: params.ts ?? nowIso(),
        };

    upsertSnapshotMessage(finalized);
    useThreadStreamStore.getState().setThreadStreamActive(params.threadId, false);
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
    upsertSnapshotToolCall(toolCall);
    this.refreshUnresolvedCount(threadId);
  }

  private handleToolCallDelta(threadId: string, payload: Record<string, unknown>): void {
    const { tempId } = this.resolveStreamingTempIdForThread(threadId, payload);
    if (!tempId) return;

    const existing = readThreadSnapshotFromCache(threadId).toolCalls.find((tc) => tc.id === tempId);
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
    patchSnapshotToolCall(threadId, tempId, patch);
  }

  private handleToolCallEnd(threadId: string, payload: Record<string, unknown>): void {
    const toolCallId = String(payload.tool_call_id ?? '');
    if (!toolCallId) return;

    const index = readOptionalIndex(payload.index);
    const { sessionKey, streamKey, tempId } = this.resolveStreamingTempIdForThread(threadId, payload);
    if (tempId) {
      removeSnapshotToolCall(threadId, tempId);
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

    upsertSnapshotToolCall(toolCall);

    const toolCallMessageId = String(payload.message_id ?? '');
    if (toolCallMessageId) {
      upsertSnapshotMessage({
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

  restoreSnapshot(threadId: string, events: ThreadRuntimeEvent[], cursor?: number): void {
    this.clearThreadStreamingState(threadId);
    useThreadStreamStore.getState().clearPreexistingLiveThread(threadId);
    setThreadSnapshotCursor(threadId, cursor);
    // This block is synchronous: live events cannot overtake the buffered tail.
    for (const event of events) this.consume(event, true);
    this.flushDeltaBuffer();
    for (const event of takeThreadSnapshotEvents(threadId, cursor)) this.consume(event);
    this.flushDeltaBuffer();
  }

  consume(event: ThreadRuntimeEvent, restoring = false): void {
    if (this.disposed) return;
    const payload = (event.data ?? {}) as Record<string, unknown>;

    if (event.event === 'thread:delete') {
      const threadId = payload.id ? String(payload.id) : '';
      if (!threadId) return;
      useThreadStreamStore.getState().removeThreadMetadata(threadId);
      removeThreadSnapshotFromCache(threadId);
      useJourneyStore.getState().clearByThreadId(threadId);
      this.clearThreadStreamingState(threadId);
      return;
    }

    if (event.event === 'thread:bulk_delete') {
      const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => String(id)).filter(Boolean) : [];
      if (ids.length === 0) return;
      useThreadStreamStore.getState().removeThreadsMetadata(ids);
      for (const threadId of ids) {
        removeThreadSnapshotFromCache(threadId);
        this.clearThreadStreamingState(threadId);
      }
      useJourneyStore.getState().clearByThreadIds(ids);
      return;
    }

    const threadId = payload.thread_id ? String(payload.thread_id) : '';
    if (!threadId) return;
    if (!restoring && !acceptThreadEvent(threadId, event)) return;

    const current = useThreadStreamStore.getState().threadsById[threadId];
    if (payload.run_seq != null && current?.latestRunSeq != null
      && Number(payload.run_seq) < current.latestRunSeq) return;
    if (event.event.startsWith('run:') && current && current.latestRunId === payload.run_id
      && current.latestRunUpdatedAt && payload.run_updated_at
      && runtimeTimestamp(String(payload.run_updated_at)) < runtimeTimestamp(current.latestRunUpdatedAt)) return;

    const threadPartial: Partial<ThreadInfo> = {
      ...(payload.run_seq != null ? { latestRunSeq: Number(payload.run_seq) } : {}),
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
      void refetchThreadSnapshot(threadId);
      return;
    }

    if (event.event === 'run:stage') {
      const stage = typeof payload.stage === 'string' ? payload.stage : null;
      if (!stage) return;
      useThreadStreamStore.getState().setThreadStage(threadId, stage);
      return;
    }

    if (event.event === 'llm:request') {
      const d = event.data as Record<string, unknown>;
      const retryCount = typeof d.retry_count === 'number' ? d.retry_count : Number(d.retry_count ?? 0);
      if (Number.isFinite(retryCount) && retryCount > 0) {
        useThreadStreamStore.getState().setThreadStage(threadId, 'retrying');
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
        useThreadStreamStore.getState().setThreadStreamActive(threadId, false);
        useThreadStreamStore.getState().setThreadStage(threadId, null);
      }
      if (isNonLiveThreadStatus(status) && useThreadStreamStore.getState().isPreexistingLiveThread(threadId)) {
        void refetchThreadSnapshot(threadId);
      }
      this.refreshUnresolvedCount(threadId);
      return;
    }

    if (event.event === 'message:user') {
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      if (!messageId || !runId) return;

      for (const message of readThreadSnapshotFromCache(threadId).messages) {
        if (message.id.startsWith('optimistic:user:') && message.role === 'user') {
          revokeMessageAttachmentObjectUrls(message);
          removeSnapshotMessage(threadId, message.id);
        }
      }

      upsertSnapshotMessage({
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
      const existing = readThreadSnapshotFromCache(threadId).messages.find((m) => m.id === messageId);
      if (existing) {
        // A delta may have created the row first; correct seq, keep accumulated streamingData.
        patchSnapshotMessage(threadId, messageId, {
          runId,
          seq: Number(payload.seq ?? existing.seq),
          seqInThread: Number(payload.seq_in_thread ?? existing.seqInThread),
        });
      } else {
        upsertSnapshotMessage({
          id: messageId,
          threadId,
          runId,
          role: 'assistant',
          seq: Number(payload.seq ?? 0),
          seqInThread: Number(payload.seq_in_thread ?? 0),
          data: {},
          attachments: [],
          streamingData: { contentParts: [] },
          isStreaming: true,
          createdAt: nowIso(),
        });
      }
      useThreadStreamStore.getState().setThreadStreamActive(threadId, true);
      return;
    }

    if (event.event === 'content:delta') {
      useThreadStreamStore.getState().setThreadStage(threadId, null);
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

      const store = useThreadStreamStore.getState();
      const existing = readThreadSnapshotFromCache(threadId).toolCalls.find((tc) => tc.id === toolCallId);
      const childThreadId = payload.child_thread_id ? String(payload.child_thread_id) : null;
      const assistantMsgId = payload.assistant_message_id ? String(payload.assistant_message_id) : null;
      if (!existing) {
        upsertSnapshotToolCall({
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
        // Re-index via upsert when recovering a missing assistantMessageId
        upsertSnapshotToolCall({
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
        patchSnapshotToolCall(threadId, toolCallId, patch);
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
      return;
    }

    if (event.event === 'message:update') {
      const store = useThreadStreamStore.getState();
      const messageId = String(payload.message_id ?? '');
      if (!messageId) return;
      const existing = readThreadSnapshotFromCache(threadId).messages.find((m) => m.id === messageId);
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
        const nextData = { ...(existing.data ?? {}), ...filtered };
        patchSnapshotMessage(threadId, messageId, { data: nextData });
      }
      store.setThreadRuntime(threadId, {
        latestMessageAt: payload.ts ? String(payload.ts) : nowIso(),
        updatedAt: payload.ts ? String(payload.ts) : nowIso(),
      });
      return;
    }

    if (event.event === 'message:end') {
      this.flushDeltaBuffer();
      const store = useThreadStreamStore.getState();
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      if (!messageId || !runId) return;

      this.finalizeAssistantMessage({
        threadId,
        messageId,
        runId,
        seqInThread: payload.seq_in_thread != null ? Number(payload.seq_in_thread) : undefined,
        data: (payload.data ?? {}) as ThreadMessage['data'],
        ts: payload.ts ? String(payload.ts) : nowIso(),
      });

      // message:end is the authoritative final state. Wipe all existing
      // tool calls for this assistant message and replace with the payload
      // in a single batched cache update to avoid per-item re-renders.
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

      // Authoritative: replace ALL tool calls for this assistant (leftover streaming temps included).
      replaceSnapshotToolCallsForAssistant(threadId, messageId, newToolCalls);
      if (newMessages.length > 0) {
        upsertSnapshotMessages(newMessages);
      }

      store.setThreadRuntime(threadId, {
        latestMessageAt: payload.ts ? String(payload.ts) : now,
        updatedAt: payload.ts ? String(payload.ts) : now,
      });

      this.refreshUnresolvedCount(threadId);
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

      const snapshot = readThreadSnapshotFromCache(threadId);
      const streamingRow = snapshot.messages.find((m) => m.id === messageId);
      if (streamingRow?.isStreaming && streamingRow.role === 'assistant') {
        removeSnapshotMessage(threadId, messageId);
        for (const tc of snapshot.toolCalls) {
          if (tc.assistantMessageId === messageId && (tc.status === 'streaming' || tc.id.startsWith('streaming:'))) {
            removeSnapshotToolCall(threadId, tc.id);
          }
        }
      }
      const store = useThreadStreamStore.getState();
      store.setThreadStage(threadId, null);
      store.setThreadStreamActive(threadId, false);
      this.refreshUnresolvedCount(threadId);
      return;
    }

    if (event.event === 'run:done') {
      this.flushDeltaBuffer();
      const finalStatus = String(payload.final_status ?? 'done') as ThreadStatus;
      this.patchThreadFromRunStatus(threadId, finalStatus, null, payload);
      useThreadStreamStore.getState().setThreadStreamActive(threadId, false);
      if (useThreadStreamStore.getState().isPreexistingLiveThread(threadId)) {
        void refetchThreadSnapshot(threadId);
      }
      this.refreshUnresolvedCount(threadId);
      return;
    }

    if (event.event === 'run:error') {
      this.flushDeltaBuffer();
      const error = String(payload.error ?? 'Unknown error');
      this.patchThreadFromRunStatus(threadId, 'error', error, payload);
      useThreadStreamStore.getState().setThreadStreamActive(threadId, false);
      if (useThreadStreamStore.getState().isPreexistingLiveThread(threadId)) {
        void refetchThreadSnapshot(threadId);
      }
      return;
    }

    if (event.event === 'run:canceled') {
      this.flushDeltaBuffer();
      this.patchThreadFromRunStatus(threadId, 'canceled', null, payload);
      useThreadStreamStore.getState().setThreadStreamActive(threadId, false);
      useThreadStreamStore.getState().clearThreadStreamingState(threadId);
      clearThreadStreamingCache(threadId);
      if (useThreadStreamStore.getState().isPreexistingLiveThread(threadId)) {
        void refetchThreadSnapshot(threadId);
      }
    }
  }
}

let sharedConsumer: ThreadEventConsumer | null = null;

export function getThreadEventConsumer(): ThreadEventConsumer {
  return sharedConsumer ??= new ThreadEventConsumer();
}

export function disposeThreadEventConsumer(): void {
  sharedConsumer?.dispose();
  sharedConsumer = null;
}
