import { threadService, type ToolCallDecisionResponse } from '../../api/threadService';
import type { ThreadRuntimeEvent } from '../../api/sseClient';
import { useSettingsStore } from '../../store/settingsStore';
import { useThreadStore } from '../../store/threadStore';
import { getAutoApproveCategory } from '../../toolCall/registry/autoApprove';
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

type AutoApproveConfig = {
  create: boolean;
  delete: boolean;
  patch: boolean;
  replace: boolean;
  read: boolean;
  search: boolean;
  subAgent: boolean;
};

const THREAD_TERMINAL_STATUSES = new Set<ThreadStatus>(['done', 'paused', 'error', 'canceled']);

function isPendingToolStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'streaming' || status === 'validating' || status === 'processing';
}

function toToolCallStatus(value: unknown): ToolCallStatus {
  const text = String(value ?? 'pending') as ToolCallStatus;
  if (
    text === 'streaming'
    || text === 'validating'
    || text === 'pending'
    || text === 'processing'
    || text === 'failed'
    || text === 'rejected'
    || text === 'applied'
  ) {
    return text;
  }
  return 'pending';
}

function isReasoningDetailType(value: unknown): value is ReasoningDetail['type'] {
  return value === 'custom'
    || value === 'openai'
    || value === 'gemini'
    || value === 'claude'
    || value === 'openrouter'
    || value === 'openai_compatible_template'
    || value === 'xai';
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

export class ThreadEventConsumer {
  private readonly projectId: string;
  private readonly streamingToolCallsByThread = new Map<string, Map<number, string>>();
  private readonly streamingArgBuffers = new Map<string, string>();
  private readonly autoContinueLockByThread = new Set<string>();
  private readonly inFlightResumeByThread = new Set<string>();
  private readonly autoAcceptLockByThread = new Set<string>();
  private readonly autoContinuedAssistantByThread = new Map<string, string>();
  private disposed = false;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  dispose(): void {
    this.disposed = true;
    this.streamingToolCallsByThread.clear();
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

    store.upsertThread({
      id: threadId,
      projectId: this.projectId,
      threadType: toThreadType(String(partial?.threadType ?? 'agent')),
      ownerId: null,
      journeyKind: null,
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
      streamingData: {
        contentParts: [],
      },
      isStreaming: true,
      createdAt: nowIso(),
    };
    store.upsertMessage(message);
    return message;
  }

  private getStreamingToolMap(threadId: string): Map<number, string> {
    const existing = this.streamingToolCallsByThread.get(threadId);
    if (existing) return existing;
    const created = new Map<number, string>();
    this.streamingToolCallsByThread.set(threadId, created);
    return created;
  }

  private patchThreadFromRunStatus(threadId: string, status: ThreadStatus, error: string | null, payload: Record<string, unknown>): void {
    const store = useThreadStore.getState();
    this.ensureThread(threadId, {
      status,
      lastError: error,
      updatedAt: String(payload.ts ?? nowIso()),
      latestRunId: payload.run_id ? String(payload.run_id) : null,
      latestRunStatus: status,
    });
    store.setThreadRuntime(threadId, {
      status,
      lastError: error,
      updatedAt: String(payload.ts ?? nowIso()),
      latestRunId: payload.run_id ? String(payload.run_id) : null,
      latestRunStatus: status,
    });
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

  private handleToolCallStart(threadId: string, payload: Record<string, unknown>): void {
    const index = Number(payload.index ?? 0);
    const assistantMessageId = payload.assistant_message_id ? String(payload.assistant_message_id) : '';
    const tempId = `streaming:${threadId}:${assistantMessageId}:${index}`;
    this.getStreamingToolMap(threadId).set(index, tempId);

    const toolCall: ThreadToolCall = {
      id: tempId,
      threadId,
      runId: payload.run_id ? String(payload.run_id) : '',
      messageId: String(payload.message_id ?? ''),
      assistantMessageId: assistantMessageId || null,
      callSeq: index,
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
    const index = Number(payload.index ?? 0);
    const tempId = this.getStreamingToolMap(threadId).get(index);
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

    const index = Number(payload.index ?? 0);
    const tempId = this.getStreamingToolMap(threadId).get(index);
    if (tempId) {
      useThreadStore.getState().removeToolCall(tempId);
      this.getStreamingToolMap(threadId).delete(index);
      this.streamingArgBuffers.delete(tempId);
    }

    const toolCall: ThreadToolCall = {
      id: toolCallId,
      threadId,
      runId: payload.run_id ? String(payload.run_id) : '',
      messageId: String(payload.message_id ?? ''),
      assistantMessageId: payload.assistant_message_id ? String(payload.assistant_message_id) : null,
      callSeq: index,
      llmCallId: toolCallId,
      toolName: String(payload.name ?? ''),
      arguments: (payload.arguments ?? {}) as Record<string, unknown>,
      extraContent: (payload.extra_content ?? null) as Record<string, unknown> | null,
      status: toToolCallStatus(payload.status ?? 'validating'),
      reason: null,
      result: null,
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

  private isToolAutoApprovable(toolName: string, config: AutoApproveConfig): boolean {
    const category = getAutoApproveCategory(toolName);
    if (category === 'create') return config.create;
    if (category === 'delete') return config.delete;
    if (category === 'patch') return config.patch;
    if (category === 'replace') return config.replace;
    if (category === 'read') return config.read;
    if (category === 'search') return config.search;
    if (category === 'subAgent') return config.subAgent;
    return false;
  }

  private async tryAutoAcceptForAssistant(threadId: string, assistantMessageId: string): Promise<void> {
    if (this.autoAcceptLockByThread.has(threadId)) return;
    const config = this.getAutoApproveConfig();
    if (!config) return;

    const store = useThreadStore.getState();
    const toolCalls = store.getToolCallsForAssistantMessage(assistantMessageId);
    const pending = toolCalls.filter((tc) => tc.status === 'pending');
    if (pending.length === 0) return;

    const allAllowed = pending.every((tc) => this.isToolAutoApprovable(tc.toolName, config));
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

      const allowedForContinue =
        thread?.status === 'waiting'
        || thread?.status === 'processing'
        || thread?.status === 'done';
      if (!allowedForContinue) {
        console.debug('[AutoContinue] Skipped: thread status not allowed', { threadId, status: thread?.status });
        return;
      }

      if (this.inFlightResumeByThread.has(threadId)) {
        console.debug('[AutoContinue] Skipped: resume already in-flight', { threadId });
        return;
      }
      this.inFlightResumeByThread.add(threadId);
      try {
        console.debug('[AutoContinue] Resuming parent thread', { threadId, assistantId: latestAssistant.id, toolCallCount: toolCalls.length });
        const response = await threadService.chat(threadId, { input_text: '' });
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
    if (payload.project_id && String(payload.project_id) !== this.projectId) return;

    const threadId = payload.thread_id ? String(payload.thread_id) : '';
    if (!threadId) return;

    const threadPartial: Partial<ThreadInfo> = {
      latestRunId: payload.run_id ? String(payload.run_id) : null,
    };
    if (payload.thread_type) {
      threadPartial.threadType = toThreadType(String(payload.thread_type));
    }
    this.ensureThread(threadId, threadPartial);

    if (event.event === 'llm:request') {
      const d = event.data as Record<string, unknown>;
      const runId = d.run_id ? String(d.run_id) : 'n/a';
      console.groupCollapsed(
        `%c[LLM Request]%c run=${runId} · ${d.provider}/${d.model}`,
        'color: #6366f1; font-weight: bold',
        'color: inherit',
      );
      console.log('Raw Request:', d.raw_request);
      console.groupEnd();
      return;
    }

    if (event.event === 'llm:response') {
      const d = event.data as Record<string, unknown>;
      const runId = d.run_id ? String(d.run_id) : 'n/a';
      console.groupCollapsed(
        `%c[LLM Response]%c run=${runId} · ${d.provider}/${d.model}`,
        'color: #10b981; font-weight: bold',
        'color: inherit',
      );
      console.log('Raw Response:', d.raw_response);
      console.groupEnd();
      return;
    }

    if (event.event === 'run:status') {
      const status = String(payload.status ?? 'running') as ThreadStatus;
      const error = payload.error ? String(payload.error) : null;
      this.patchThreadFromRunStatus(threadId, status, error, payload);
      if (THREAD_TERMINAL_STATUSES.has(status)) {
        useThreadStore.getState().setThreadStreamActive(threadId, false);
      }
      await this.checkAutoContinue(threadId);
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
        isStreaming: false,
        createdAt: nowIso(),
      });
      return;
    }

    if (event.event === 'message:start') {
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
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      const text = String(payload.text ?? '');
      if (!messageId || !runId || !text) return;
      this.appendDelta({ threadId, messageId, runId, text });
      return;
    }

    if (event.event === 'thinking:delta') {
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      const text = String(payload.text ?? '');
      const thinkingDisplay = String(payload.thinking_display ?? '').trim();
      if (!messageId || !runId || !text || !thinkingDisplay) return;
      this.appendThinkingDelta({ threadId, messageId, runId, text, thinkingDisplay });
      return;
    }

    if (event.event === 'tool_call:start') {
      this.handleToolCallStart(threadId, payload);
      return;
    }

    if (event.event === 'tool_call:delta') {
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
          status: toToolCallStatus(payload.status),
          reason: payload.reason ? String(payload.reason) : null,
          result: (payload.result ?? null) as Record<string, unknown> | null,
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
          reason: payload.reason ? String(payload.reason) : null,
          result: (payload.result ?? null) as Record<string, unknown> | null,
          assistantMessageId: assistantMsgId,
          childThreadId: childThreadId ?? existing.childThreadId,
          updatedAt: nowIso(),
        });
      } else {
        const patch: Partial<ThreadToolCall> = {
          status: toToolCallStatus(payload.status),
          reason: payload.reason ? String(payload.reason) : null,
          result: (payload.result ?? null) as Record<string, unknown> | null,
          updatedAt: nowIso(),
        };
        if (childThreadId) patch.childThreadId = childThreadId;
        store.patchToolCall(toolCallId, patch);
      }

      if (childThreadId) {
        this.ensureThread(childThreadId, {
          threadType: 'subAgent',
          updatedAt: nowIso(),
        });
      }

      await this.checkAutoContinue(threadId);
      this.refreshUnresolvedCount(threadId);
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
      // tool calls for this assistant message and replace with the payload.
      const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls as Record<string, unknown>[] : [];
      const existingToolCalls = store.getToolCallsForAssistantMessage(messageId);
      for (const tc of existingToolCalls) {
        store.removeToolCall(tc.id);
      }
      const toolMap = this.streamingToolCallsByThread.get(threadId);
      if (toolMap) {
        for (const tempId of toolMap.values()) this.streamingArgBuffers.delete(tempId);
      }
      this.streamingToolCallsByThread.delete(threadId);

      for (const tc of toolCalls) {
        const toolCallId = String(tc.tool_call_id ?? '');
        if (!toolCallId) continue;

        store.upsertToolCall({
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
          childThreadId: null,
          acceptedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });

        const toolCallMessageId = String(tc.message_id ?? '');
        if (toolCallMessageId) {
          store.upsertMessage({
            id: toolCallMessageId,
            threadId,
            runId,
            role: 'tool_call',
            seq: 0,
            seqInThread: Number(tc.seq_in_thread ?? 0),
            data: {},
            isStreaming: false,
            createdAt: nowIso(),
          });
        }
      }

      store.setThreadRuntime(threadId, {
        latestMessageAt: payload.ts ? String(payload.ts) : nowIso(),
        updatedAt: payload.ts ? String(payload.ts) : nowIso(),
      });

      await this.tryAutoAcceptForAssistant(threadId, messageId);
      await this.checkAutoContinue(threadId);
      this.refreshUnresolvedCount(threadId);
      return;
    }

    if (event.event === 'run:done') {
      const finalStatus = String(payload.final_status ?? 'done') as ThreadStatus;
      this.patchThreadFromRunStatus(threadId, finalStatus, null, payload);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
      await this.checkAutoContinue(threadId);
      return;
    }

    if (event.event === 'run:error') {
      const error = String(payload.error ?? 'Unknown error');
      this.patchThreadFromRunStatus(threadId, 'error', error, payload);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
      return;
    }

    if (event.event === 'run:canceled') {
      this.patchThreadFromRunStatus(threadId, 'canceled', null, payload);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
    }
  }
}
