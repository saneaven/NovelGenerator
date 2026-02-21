import { threadService, type ToolCallDecisionResponse } from '../../api/threadService';
import type { ThreadRuntimeEvent } from '../../api/sseClient';
import { useSettingsStore } from '../../store/settingsStore';
import { useThreadStore } from '../../store/threadStore';
import { getAutoApproveCategory } from '../../toolCall/registry/autoApprove';
import {
  toThreadType,
  nowIso,
  type ThreadInfo,
  type ThreadMessage,
  type ThreadStatus,
  type ThreadToolCall,
  type ToolCallStatus,
} from '../../types/thread';

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
    partType: 'content' | 'thinking';
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
    if (last && last.type === params.partType) {
      parts[parts.length - 1] = { type: params.partType, text: last.text + params.text };
    } else {
      parts.push({ type: params.partType, text: params.text });
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

  private finalizeStreamingMessagesForThread(threadId: string): void {
    const store = useThreadStore.getState();
    const messages = store.getMessages(threadId);
    for (const msg of messages) {
      if (msg.isStreaming) {
        store.patchMessage(threadId, msg.id, {
          isStreaming: false,
          streamingData: undefined,
        });
      }
    }

    const toolMap = this.streamingToolCallsByThread.get(threadId);
    if (toolMap) {
      for (const tempId of toolMap.values()) {
        store.removeToolCall(tempId);
        this.streamingArgBuffers.delete(tempId);
      }
      this.streamingToolCallsByThread.delete(threadId);
    }

    store.setThreadStreamActive(threadId, false);
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
    if (this.autoContinueLockByThread.has(threadId)) return;
    this.autoContinueLockByThread.add(threadId);
    try {
      const store = useThreadStore.getState();
      const thread = store.threadsById[threadId];
      const latestRunId = thread?.latestRunId ?? null;
      const messages = store.getMessages(threadId);
      const latestAssistant = [...messages]
        .sort((a, b) => b.seqInThread - a.seqInThread)
        .find((m) => m.role === 'assistant');
      if (!latestAssistant) return;

      // Ignore stale assistants from older runs.
      if (latestRunId && latestAssistant.runId && latestAssistant.runId !== latestRunId) return;

      // Prevent repeated auto-continue on the same assistant message.
      if (this.autoContinuedAssistantByThread.get(threadId) === latestAssistant.id) return;

      const toolCalls = store.getToolCallsForAssistantMessage(latestAssistant.id);
      if (toolCalls.length === 0) return;

      if (!toolCalls.every((tc) => tc.status === 'applied' || tc.status === 'failed')) return;

      const allowedForContinue =
        thread?.status === 'waiting'
        || thread?.status === 'done';
      if (!allowedForContinue) return;

      if (this.inFlightResumeByThread.has(threadId)) return;
      this.inFlightResumeByThread.add(threadId);
      this.autoContinuedAssistantByThread.set(threadId, latestAssistant.id);
      try {
        const response = await threadService.chat(threadId, { input_text: '' });
        store.setThreadRuntime(threadId, {
          status: response.threadStatus,
          latestRunId: response.runId,
          latestRunStatus: response.status,
          updatedAt: nowIso(),
        });
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
      const msgs = d.messages as Array<{ role: string }> | null;
      const runId = d.run_id ? String(d.run_id) : 'n/a';
      console.groupCollapsed(
        `%c[LLM Request]%c run=${runId} · ${d.provider}/${d.model} · temp=${d.temperature} · ${msgs?.length ?? 0} msgs`,
        'color: #6366f1; font-weight: bold',
        'color: inherit',
      );
      console.log('Run ID:', runId);
      console.log('Provider:', d.provider);
      console.log('Model:', d.model);
      console.log('Temperature:', d.temperature);
      console.log('Max Tokens:', d.max_tokens);
      console.log('Tool Choice:', d.tool_choice);
      console.log('Thinking:', d.thinking_mode, d.thinking_config);
      console.log('Native Tool Call:', d.native_tool_call);
      console.log('Messages:', d.messages);
      if (d.tools) console.log('Full tool schemas:', d.tools);
      console.groupEnd();
      return;
    }

    if (event.event === 'run:status') {
      const status = String(payload.status ?? 'running') as ThreadStatus;
      const error = payload.error ? String(payload.error) : null;
      this.patchThreadFromRunStatus(threadId, status, error, payload);
      if (THREAD_TERMINAL_STATUSES.has(status)) {
        this.finalizeStreamingMessagesForThread(threadId);
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
      this.appendDelta({ threadId, messageId, runId, partType: 'content', text });
      return;
    }

    if (event.event === 'thinking:delta') {
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      const text = String(payload.text ?? '');
      if (!messageId || !runId || !text) return;
      this.appendDelta({ threadId, messageId, runId, partType: 'thinking', text });
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
      if (!existing) {
        store.upsertToolCall({
          id: toolCallId,
          threadId,
          runId: payload.run_id ? String(payload.run_id) : '',
          messageId: '',
          assistantMessageId: null,
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
      store.patchMessage(threadId, messageId, {
        data: {
          ...(existing.data ?? {}),
          ...(patchData ?? {}),
        },
      });
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
      this.finalizeStreamingMessagesForThread(threadId);
      return;
    }

    if (event.event === 'run:canceled') {
      this.patchThreadFromRunStatus(threadId, 'canceled', null, payload);
      this.finalizeStreamingMessagesForThread(threadId);
    }
  }
}
