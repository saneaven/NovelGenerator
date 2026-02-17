import { connectThreadStream, type ThreadSSEEvent } from '../api/sseClient';
import {
  threadService,
  type ChatRequest,
  type ToolCallBatchDecisionRequest,
  type ToolCallDecisionResponse,
} from '../api/threadService';
import { useSettingsStore } from '../store/settingsStore';
import { useThreadStore } from '../store/threadStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type {
  ThreadInfo,
  ThreadMessage,
  ThreadStatus,
  ThreadToolCall,
  ThreadType,
  ToolCallStatus,
} from '../types/thread';

type EngineThreadType = 'agent' | 'subAgent' | 'journey';

interface ChatEngineParams {
  threadId: string;
  projectId: string;
  threadType: EngineThreadType;
}

function toThreadType(threadType: EngineThreadType): ThreadType {
  if (threadType === 'subAgent') return 'subAgent';
  if (threadType === 'journey') return 'journey';
  return 'agent';
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return status === 'applied' || status === 'failed' || status === 'rejected';
}

function isPendingToolStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'streaming' || status === 'validating' || status === 'processing';
}

type AutoApproveConfig = {
  create: boolean;
  delete: boolean;
  patch: boolean;
  replace: boolean;
  read: boolean;
  search: boolean;
  subAgent: boolean;
};

export class ChatEngine {
  private readonly threadId: string;
  private readonly projectId: string;
  private readonly threadType: EngineThreadType;

  private initialized = false;
  private streamAbort: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private inFlightChat = false;
  private autoContinueLock = false;
  private lastRunId: string | null = null;
  /** Maps tool-call delta index → temporary store ID during LLM streaming. */
  private streamingToolCalls = new Map<number, string>();

  constructor(params: ChatEngineParams) {
    this.threadId = params.threadId;
    this.projectId = params.projectId;
    this.threadType = params.threadType;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      this.ensureStreamConnected();
      return;
    }
    await this.reloadSnapshot();
    this.initialized = true;
    this.ensureStreamConnected();
  }

  async send(inputText: string, opts?: Partial<ChatRequest>): Promise<void> {
    const trimmed = inputText.trim();
    if (!trimmed) {
      await this.resume(opts);
      return;
    }
    await this.init();
    if (this.inFlightChat) return;

    this.inFlightChat = true;
    try {
      const response = await threadService.chat(this.threadId, {
        input_text: trimmed,
        ...opts,
      });
      this.lastRunId = response.runId;
      this.upsertThreadStatus(response.threadStatus, null);
      this.ensureStreamConnected();
    } finally {
      this.inFlightChat = false;
    }
  }

  async resume(opts?: Partial<ChatRequest>): Promise<void> {
    await this.init();
    if (this.inFlightChat) return;

    this.inFlightChat = true;
    try {
      const response = await threadService.chat(this.threadId, {
        input_text: '',
        ...opts,
      });
      this.lastRunId = response.runId;
      this.upsertThreadStatus(response.threadStatus, null);
      this.ensureStreamConnected();
    } finally {
      this.inFlightChat = false;
    }
  }

  async acceptToolCall(toolCallId: string, reason?: string): Promise<void> {
    const response = await threadService.decideToolCall(this.threadId, toolCallId, {
      decision: 'accept',
      reason,
    });
    this.applyToolDecisionResponse(response);
    await this.checkAutoContinue();
  }

  async rejectToolCall(toolCallId: string, reason?: string): Promise<void> {
    const response = await threadService.decideToolCall(this.threadId, toolCallId, {
      decision: 'reject',
      reason,
    });
    this.applyToolDecisionResponse(response);
    await this.checkAutoContinue();
  }

  async acceptToolCallsBatch(ids: string[]): Promise<void> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;

    const req: ToolCallBatchDecisionRequest = {
      decisions: unique.map((id) => ({
        tool_call_id: id,
        decision: 'accept',
      })),
    };
    const response = await threadService.decideToolCallsBatch(this.threadId, req);
    response.results.forEach((item) => this.applyToolDecisionResponse(item));
    await this.checkAutoContinue();
  }

  async completeSubAgentToolCall(toolCallId: string, result: string): Promise<void> {
    const response = await threadService.completeSubAgentToolCall(this.threadId, toolCallId, {
      result,
    });
    this.applyToolDecisionResponse(response);
    await this.checkAutoContinue();
  }

  async cancel(runId?: string): Promise<void> {
    const target = runId ?? this.lastRunId;
    if (!target) return;
    await threadService.cancelRun(this.threadId, target);
  }

  disconnectSSE(): void {
    if (this.streamAbort) {
      this.streamAbort.abort();
    }
    this.streamAbort = null;
    this.streamTask = null;
    this.streamingToolCalls.clear();
    useThreadStore.getState().setThreadStreamActive(this.threadId, false);
  }

  private async reloadSnapshot(): Promise<void> {
    this.streamingToolCalls.clear();
    const snapshot = await threadService.listMessages(this.threadId);
    const store = useThreadStore.getState();
    store.upsertThread(snapshot.thread);
    store.replaceMessagesAndToolCalls(this.threadId, snapshot.messages, snapshot.toolCalls);
    if (snapshot.latestRun?.id) {
      this.lastRunId = snapshot.latestRun.id;
    }
  }

  private ensureStreamConnected(): void {
    if (this.streamTask) return;

    this.streamAbort = new AbortController();
    useThreadStore.getState().setThreadStreamActive(this.threadId, true);

    this.streamTask = connectThreadStream(
      this.threadId,
      (event) => {
        void this.handleSseEvent(event);
      },
      this.streamAbort.signal,
      {
        onReconnect: async () => {
          await this.reloadSnapshot();
        },
      },
    )
      .catch((error) => {
        if (this.streamAbort?.signal.aborted) return;
        console.error('Thread stream failed', { threadId: this.threadId, error });
      })
      .finally(() => {
        useThreadStore.getState().setThreadStreamActive(this.threadId, false);
        this.streamTask = null;
        this.streamAbort = null;
      });
  }

  private upsertThreadStatus(status: ThreadStatus, error: string | null): void {
    const store = useThreadStore.getState();
    const existing = store.threadsById[this.threadId];
    const partial: Partial<ThreadInfo> = { status, lastError: error };
    if (existing) {
      store.patchThread(this.threadId, partial);
      return;
    }
    store.upsertThread({
      id: this.threadId,
      projectId: this.projectId,
      threadType: toThreadType(this.threadType),
      ownerId: null,
      journeyKind: null,
      status,
      lastError: error,
    });
  }

  private ensureMessage(params: {
    messageId: string;
    runId: string;
    role: ThreadMessage['role'];
    seq?: number;
    seqInThread?: number;
  }): ThreadMessage {
    const store = useThreadStore.getState();
    const existing = store.getMessages(this.threadId).find((m) => m.id === params.messageId);
    if (existing) return existing;

    const message: ThreadMessage = {
      id: params.messageId,
      threadId: this.threadId,
      runId: params.runId,
      role: params.role,
      seq: params.seq ?? 0,
      seqInThread: params.seqInThread ?? 0,
      data: {
        _streaming: {
          contentParts: [],
          thinkingDetails: [],
        },
      },
      isStreaming: true,
      createdAt: nowIso(),
    };
    store.appendMessage(message);
    return message;
  }

  private appendDelta(messageId: string, runId: string, partType: 'content' | 'thinking', text: string): void {
    const store = useThreadStore.getState();
    const message = this.ensureMessage({
      messageId,
      runId,
      role: 'assistant',
    });

    const streaming = message.data._streaming ?? { contentParts: [], thinkingDetails: [] };
    const nextParts = [...(streaming.contentParts ?? [])];
    nextParts.push({ type: partType, text });
    store.updateMessageData(this.threadId, messageId, '_streaming', {
      contentParts: nextParts,
      thinkingDetails: streaming.thinkingDetails ?? [],
    });
    store.patchMessage(this.threadId, messageId, { isStreaming: true });
  }

  private handleToolCallStart(payload: Record<string, unknown>): void {
    const index = Number(payload.index ?? 0);
    const assistantMessageId = payload.assistant_message_id ? String(payload.assistant_message_id) : '';
    const tempId = `streaming:${assistantMessageId}:${index}`;
    this.streamingToolCalls.set(index, tempId);

    const runId = String(payload.run_id ?? this.lastRunId ?? '');
    const toolCall: ThreadToolCall = {
      id: tempId,
      threadId: this.threadId,
      runId,
      messageId: '',
      assistantMessageId: assistantMessageId || null,
      resultMessageId: null,
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
  }

  private handleToolCallDelta(payload: Record<string, unknown>): void {
    const index = Number(payload.index ?? 0);
    const tempId = this.streamingToolCalls.get(index);
    if (!tempId) return;

    const store = useThreadStore.getState();
    const existing = store.toolCallsById[tempId];
    if (!existing) return;

    const argsDelta = String(payload.arguments_delta ?? '');
    const name = payload.name ? String(payload.name) : '';

    // Accumulate raw argument text for display.
    const prevRaw = (existing.arguments._rawStreaming as string) ?? '';
    const nextRaw = prevRaw + argsDelta;
    let parsed: Record<string, unknown> = { _rawStreaming: nextRaw };
    try {
      const obj = JSON.parse(nextRaw);
      if (typeof obj === 'object' && obj !== null) {
        parsed = { ...obj, _rawStreaming: nextRaw };
      }
    } catch {
      // Arguments still incomplete — keep raw text only.
    }

    const patch: Partial<ThreadToolCall> = { arguments: parsed, updatedAt: nowIso() };
    if (name) patch.toolName = name;
    if (payload.tool_call_id) patch.llmCallId = String(payload.tool_call_id);
    store.patchToolCall(tempId, patch);
  }

  private handleToolCallEnd(payload: Record<string, unknown>): void {
    const toolCallId = String(payload.tool_call_id ?? '');
    if (!toolCallId) return;

    // Clean up the temporary streaming entry for this index.
    const index = Number(payload.index ?? 0);
    const tempId = this.streamingToolCalls.get(index);
    if (tempId) {
      useThreadStore.getState().removeToolCall(tempId);
      this.streamingToolCalls.delete(index);
    }

    const runId = String(payload.run_id ?? this.lastRunId ?? '');
    const toolCall: ThreadToolCall = {
      id: toolCallId,
      threadId: this.threadId,
      runId,
      messageId: String(payload.message_id ?? ''),
      assistantMessageId: payload.assistant_message_id ? String(payload.assistant_message_id) : null,
      resultMessageId: null,
      callSeq: index,
      llmCallId: toolCallId,
      toolName: String(payload.name ?? ''),
      arguments: (payload.arguments ?? {}) as Record<string, unknown>,
      status: 'streaming',
      reason: null,
      result: null,
      childThreadId: null,
      acceptedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    useThreadStore.getState().upsertToolCall(toolCall);
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

  private async tryAutoAcceptForAssistant(assistantMessageId: string): Promise<void> {
    const config = this.getAutoApproveConfig();
    if (!config) return;

    const store = useThreadStore.getState();
    const toolCalls = store.getToolCallsForAssistantMessage(assistantMessageId);
    const pending = toolCalls.filter((tc) => tc.status === 'pending');
    if (pending.length === 0) return;

    const allAllowed = pending.every((tc) => this.isToolAutoApprovable(tc.toolName, config));
    if (!allAllowed) return;

    await this.acceptToolCallsBatch(pending.map((tc) => tc.id));
  }

  private async checkAutoContinue(): Promise<void> {
    if (this.autoContinueLock) return;

    this.autoContinueLock = true;
    try {
      const store = useThreadStore.getState();
      const messages = store.getMessages(this.threadId);
      const latestAssistant = [...messages]
        .sort((a, b) => b.seqInThread - a.seqInThread)
        .find((m) => m.role === 'assistant');
      if (!latestAssistant) return;

      const toolCalls = store.getToolCallsForAssistantMessage(latestAssistant.id);
      if (toolCalls.length === 0) return;

      if (toolCalls.some((tc) => isPendingToolStatus(tc.status))) {
        if (toolCalls.some((tc) => tc.status === 'pending')) {
          this.upsertThreadStatus('waiting', null);
        } else {
          this.upsertThreadStatus('processing', null);
        }
        return;
      }

      const terminal = toolCalls.filter((tc) => isTerminalToolStatus(tc.status));
      if (terminal.length !== toolCalls.length) return;

      const hasRejected = terminal.some((tc) => tc.status === 'rejected');
      if (hasRejected) {
        this.upsertThreadStatus('paused', null);
        return;
      }

      if (!this.inFlightChat) {
        await this.resume();
      }
    } finally {
      this.autoContinueLock = false;
    }
  }

  private async handleSseEvent(event: ThreadSSEEvent): Promise<void> {
    const payload = (event.data ?? {}) as Record<string, unknown>;

    if (event.event === 'run:status') {
      const status = String(payload.status ?? 'running') as ThreadStatus;
      const error = payload.error ? String(payload.error) : null;
      this.lastRunId = String(payload.run_id ?? this.lastRunId ?? '');
      this.upsertThreadStatus(status, error);
      return;
    }

    if (event.event === 'message:start') {
      const messageId = String(payload.message_id ?? '');
      const runId = String(payload.run_id ?? this.lastRunId ?? '');
      if (!messageId || !runId) return;

      this.ensureMessage({
        messageId,
        runId,
        role: 'assistant',
        seq: Number(payload.seq ?? 0),
        seqInThread: Number(payload.seq_in_thread ?? 0),
      });
      return;
    }

    if (event.event === 'content:delta') {
      const messageId = String(payload.message_id ?? '');
      const runId = String(payload.run_id ?? this.lastRunId ?? '');
      const text = String(payload.text ?? '');
      if (!messageId || !runId || !text) return;
      this.appendDelta(messageId, runId, 'content', text);
      return;
    }

    if (event.event === 'thinking:delta') {
      const messageId = String(payload.message_id ?? '');
      const runId = String(payload.run_id ?? this.lastRunId ?? '');
      const text = String(payload.text ?? '');
      if (!messageId || !runId || !text) return;
      this.appendDelta(messageId, runId, 'thinking', text);
      return;
    }

    if (event.event === 'tool_call:start') {
      this.handleToolCallStart(payload);
      return;
    }

    if (event.event === 'tool_call:delta') {
      this.handleToolCallDelta(payload);
      return;
    }

    if (event.event === 'tool_call:end') {
      this.handleToolCallEnd(payload);
      return;
    }

    if (event.event === 'tool_call:status') {
      const toolCallId = String(payload.tool_call_id ?? '');
      if (!toolCallId) return;

      useThreadStore.getState().patchToolCall(toolCallId, {
        status: String(payload.status ?? 'pending') as ToolCallStatus,
        reason: payload.reason ? String(payload.reason) : null,
        result: (payload.result ?? null) as Record<string, unknown> | null,
        updatedAt: nowIso(),
      });
      await this.checkAutoContinue();
      return;
    }

    if (event.event === 'message:end') {
      const store = useThreadStore.getState();
      const messageId = String(payload.message_id ?? '');
      const runId = String(payload.run_id ?? this.lastRunId ?? '');
      if (!messageId || !runId) return;

      const existing = store.getMessages(this.threadId).find((m) => m.id === messageId);
      if (!existing) {
        store.appendMessage({
          id: messageId,
          threadId: this.threadId,
          runId,
          role: 'assistant',
          seq: 0,
          seqInThread: Number(payload.seq_in_thread ?? 0),
          data: (payload.data ?? {}) as ThreadMessage['data'],
          isStreaming: false,
          createdAt: nowIso(),
        });
      } else {
        store.patchMessage(this.threadId, messageId, {
          runId,
          data: (payload.data ?? {}) as ThreadMessage['data'],
          seqInThread: Number(payload.seq_in_thread ?? existing.seqInThread ?? 0),
          isStreaming: false,
        });
      }

      await this.tryAutoAcceptForAssistant(messageId);
      await this.checkAutoContinue();
      return;
    }

    if (event.event === 'run:done') {
      const finalStatus = String(payload.final_status ?? 'done') as ThreadStatus;
      this.lastRunId = String(payload.run_id ?? this.lastRunId ?? '');
      this.upsertThreadStatus(finalStatus, null);
      return;
    }

    if (event.event === 'run:error') {
      this.lastRunId = String(payload.run_id ?? this.lastRunId ?? '');
      this.upsertThreadStatus('error', String(payload.error ?? 'Unknown error'));
      return;
    }

    if (event.event === 'run:canceled') {
      this.lastRunId = String(payload.run_id ?? this.lastRunId ?? '');
      this.upsertThreadStatus('canceled', null);
    }
  }
}

export default ChatEngine;
