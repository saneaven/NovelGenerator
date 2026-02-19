import { connectProjectStream, type ThreadSSEEvent } from '../api/sseClient';
import { threadService, type ToolCallDecisionResponse } from '../api/threadService';
import { useSettingsStore } from '../store/settingsStore';
import { useThreadStore } from '../store/threadStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import {
  toThreadType,
  nowIso,
  type ThreadInfo,
  type ThreadMessage,
  type ThreadStatus,
  type ThreadToolCall,
  type ToolCallStatus,
} from '../types/thread';

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

class ProjectRuntimeConnection {
  readonly projectId: string;
  private refCount = 0;
  private abortController: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private trackedThreadIds = new Set<string>();
  private streamingToolCallsByThread = new Map<string, Map<number, string>>();
  /** Raw argument buffer for streaming tool calls, keyed by temp ID. */
  private streamingArgBuffers = new Map<string, string>();
  private autoContinueLockByThread = new Set<string>();
  private inFlightResumeByThread = new Set<string>();
  private autoAcceptLockByThread = new Set<string>();
  private disposed = false;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  async start(): Promise<void> {
    this.refCount += 1;
    if (this.streamTask) return;
    await this.syncRuntimeSnapshot();
    if (this.disposed) return;
    this.connect();
  }

  stop(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
    this.streamTask = null;
    this.trackedThreadIds.clear();
    this.streamingToolCallsByThread.clear();
    this.streamingArgBuffers.clear();
    this.autoContinueLockByThread.clear();
    this.inFlightResumeByThread.clear();
    this.autoAcceptLockByThread.clear();
  }

  isIdle(): boolean {
    return this.refCount === 0;
  }

  registerThread(threadId: string): void {
    if (!threadId) return;
    this.trackedThreadIds.add(threadId);
  }

  unregisterThread(threadId: string): void {
    if (!threadId) return;
    this.trackedThreadIds.delete(threadId);
    this.streamingToolCallsByThread.delete(threadId);
  }

  async loadThreadSnapshot(threadId: string): Promise<void> {
    if (!threadId) return;
    this.trackedThreadIds.add(threadId);
    try {
      const snapshot = await threadService.listMessages(threadId);
      const store = useThreadStore.getState();
      store.upsertThread(snapshot.thread);
      store.replaceMessagesAndToolCalls(threadId, snapshot.messages, snapshot.toolCalls);
      this.refreshUnresolvedCount(threadId);
      await this.checkAutoContinue(threadId);
    } catch (error) {
      console.warn('Failed to load thread snapshot', { threadId, error });
    }
  }

  private connect(): void {
    if (this.streamTask) return;
    this.abortController = new AbortController();
    this.streamTask = connectProjectStream(
      this.projectId,
      (event) => {
        void this.handleEvent(event);
      },
      this.abortController.signal,
      {
        onReconnect: async () => {
          this.streamingToolCallsByThread.clear();
          this.streamingArgBuffers.clear();
          await this.syncRuntimeSnapshot();
          await Promise.all([...this.trackedThreadIds].map((threadId) => this.loadThreadSnapshot(threadId)));
        },
      },
    ).catch((error) => {
      if (this.abortController?.signal.aborted) return;
      console.error('Project runtime stream failed', { projectId: this.projectId, error });
    }).finally(() => {
      this.streamTask = null;
      this.abortController = null;
    });
  }

  private async syncRuntimeSnapshot(): Promise<void> {
    try {
      const runtime = await threadService.listProjectThreadRuntime(this.projectId);
      useThreadStore.getState().upsertThreadsRuntime(runtime);
    } catch (error) {
      console.warn('Failed to sync project runtime snapshot', { projectId: this.projectId, error });
    }
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
        thinkingDetails: [],
      },
      isStreaming: true,
      createdAt: nowIso(),
    };
    store.appendMessage(message);
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
    const streaming = message.streamingData ?? { contentParts: [], thinkingDetails: [] };
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
        thinkingDetails: streaming.thinkingDetails ?? [],
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

    // Clean up streaming tool call tracking for this thread.
    const toolMap = this.streamingToolCallsByThread.get(threadId);
    if (toolMap) {
      for (const tempId of toolMap.values()) {
        store.removeToolCall(tempId);
        this.streamingArgBuffers.delete(tempId);
      }
      this.streamingToolCallsByThread.delete(threadId);
    }
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

    // Create the tool_call role message so it appears in the timeline.
    const toolCallMessageId = String(payload.message_id ?? '');
    if (toolCallMessageId && !store.getMessages(threadId).some((m) => m.id === toolCallMessageId)) {
      store.appendMessage({
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

    const toolResult = response.toolCall.result as Record<string, unknown> | null | undefined;
    const deletedId = toolResult && typeof toolResult.deleted === 'object'
      ? String((toolResult.deleted as Record<string, unknown>).id ?? '')
      : '';
    const deletedIds = deletedId ? [deletedId] : [];
    const objects = Array.isArray(response.newObjects) ? response.newObjects : [];
    useUnifiedObjectStore.getState().applyAffectedObjects(objects as any[], deletedIds);
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
    if (toolName.startsWith('create_')) return config.create;
    if (toolName.startsWith('delete_')) return config.delete;
    if (toolName.startsWith('patch_')) return config.patch;
    if (toolName.startsWith('replace_')) return config.replace;
    if (toolName.startsWith('read_')) return config.read;
    if (toolName === 'rag_search' || toolName === 'keyword_search') return config.search;
    if (toolName.startsWith('call_')) return config.subAgent;
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
      const messages = store.getMessages(threadId);
      const latestAssistant = [...messages]
        .sort((a, b) => b.seqInThread - a.seqInThread)
        .find((m) => m.role === 'assistant');
      if (!latestAssistant) return;

      const toolCalls = store.getToolCallsForAssistantMessage(latestAssistant.id);
      if (toolCalls.length === 0) return;

      if (!toolCalls.every((tc) => tc.status === 'applied')) return;

      const thread = store.threadsById[threadId];
      const blockedByPausedOrError =
        thread?.status === 'paused'
        || thread?.status === 'error'
        || thread?.latestRunStatus === 'paused'
        || thread?.latestRunStatus === 'error';
      if (blockedByPausedOrError) return;

      if (this.inFlightResumeByThread.has(threadId)) return;
      this.inFlightResumeByThread.add(threadId);
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

  private async handleEvent(event: ThreadSSEEvent): Promise<void> {
    const payload = (event.data ?? {}) as Record<string, unknown>;
    const threadId = payload.thread_id ? String(payload.thread_id) : '';
    if (!threadId) return;
    if (payload.project_id && String(payload.project_id) !== this.projectId) return;

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
      // Remove any optimistic user messages for this thread.
      const existing = store.getMessages(threadId);
      for (const m of existing) {
        if (m.id.startsWith('optimistic:user:') && m.role === 'user') {
          store.removeMessage(threadId, m.id);
        }
      }
      // Upsert the real user message if it doesn't already exist.
      if (!existing.some((m) => m.id === messageId)) {
        store.appendMessage({
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
      }
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

      // Load child thread info so SubAgentPeekDock can render immediately
      if (childThreadId) {
        this.trackedThreadIds.add(childThreadId);
        void this.loadThreadSnapshot(childThreadId);
      }

      await this.checkAutoContinue(threadId);
      this.refreshUnresolvedCount(threadId);
      return;
    }

    if (event.event === 'message:end') {
      const store = useThreadStore.getState();
      const messageId = String(payload.message_id ?? '');
      const runId = payload.run_id ? String(payload.run_id) : '';
      if (!messageId || !runId) return;

      const existing = store.getMessages(threadId).find((m) => m.id === messageId);
      if (!existing) {
        store.appendMessage({
          id: messageId,
          threadId,
          runId,
          role: 'assistant',
          seq: 0,
          seqInThread: Number(payload.seq_in_thread ?? 0),
          data: (payload.data ?? {}) as ThreadMessage['data'],
          streamingData: undefined,
          isStreaming: false,
          createdAt: nowIso(),
        });
      } else {
        store.patchMessage(threadId, messageId, {
          runId,
          data: (payload.data ?? {}) as ThreadMessage['data'],
          streamingData: undefined,
          seqInThread: Number(payload.seq_in_thread ?? existing.seqInThread ?? 0),
          isStreaming: false,
        });
      }

      store.setThreadRuntime(threadId, {
        latestMessageAt: payload.ts ? String(payload.ts) : nowIso(),
        updatedAt: payload.ts ? String(payload.ts) : nowIso(),
      });
      store.setThreadStreamActive(threadId, false);

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
      useThreadStore.getState().setThreadStreamActive(threadId, false);
      return;
    }

    if (event.event === 'run:canceled') {
      this.patchThreadFromRunStatus(threadId, 'canceled', null, payload);
      this.finalizeStreamingMessagesForThread(threadId);
      useThreadStore.getState().setThreadStreamActive(threadId, false);
    }
  }
}

class ThreadRuntimeCoordinator {
  private byProject = new Map<string, ProjectRuntimeConnection>();

  private getOrCreate(projectId: string): ProjectRuntimeConnection {
    const existing = this.byProject.get(projectId);
    if (existing) return existing;
    const created = new ProjectRuntimeConnection(projectId);
    this.byProject.set(projectId, created);
    return created;
  }

  async start(projectId: string): Promise<void> {
    if (!projectId) return;
    const conn = this.getOrCreate(projectId);
    await conn.start();
  }

  stop(projectId: string): void {
    if (!projectId) return;
    const conn = this.byProject.get(projectId);
    if (!conn) return;
    conn.stop();
    if (conn.isIdle()) {
      this.byProject.delete(projectId);
    }
  }

  registerThread(projectId: string, threadId: string): void {
    if (!projectId || !threadId) return;
    this.getOrCreate(projectId).registerThread(threadId);
  }

  unregisterThread(projectId: string, threadId: string): void {
    if (!projectId || !threadId) return;
    const conn = this.byProject.get(projectId);
    if (!conn) return;
    conn.unregisterThread(threadId);
  }

  async loadThreadSnapshot(projectId: string, threadId: string): Promise<void> {
    if (!projectId || !threadId) return;
    await this.getOrCreate(projectId).loadThreadSnapshot(threadId);
  }
}

export const threadRuntimeCoordinator = new ThreadRuntimeCoordinator();
export default threadRuntimeCoordinator;
