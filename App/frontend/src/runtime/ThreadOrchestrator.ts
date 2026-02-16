/**
 * Thread-centric orchestrator.
 *
 * Replaces RuntimeOrchestrator.ts — all operations keyed by threadId.
 * No run IDs exposed to callers (except internally for SSE subscriptions).
 */

import { threadService, type StreamHandle, type ThreadEvent } from '../api/threadService';
import {
  useThreadStore,
  type ThreadInfo,
  type ThreadMessage,
  type ThreadToolCall,
} from './store/threadStore';
import { createClientMessageId, isUuid } from '../utils/idUtils';

// ── Helpers ──

type ThreadToolCallStatus = ThreadToolCall['status'];

const TERMINAL_TOOL_STATUSES: ReadonlySet<ThreadToolCallStatus> = new Set([
  'accepted',
  'rejected',
  'cancelled',
]);

function parseThreadToolCallStatus(raw: unknown): ThreadToolCallStatus {
  if (raw === 'pending' || raw === 'running' || raw === 'accepted' || raw === 'rejected' || raw === 'cancelled') {
    return raw;
  }
  throw new Error(`Invalid tool call status: ${String(raw)}`);
}

interface PendingUserMessageRef {
  threadId: string;
  pendingMessageId: string;
}

function mapBackendMessage(raw: any): ThreadMessage {
  return {
    id: raw.id,
    threadId: raw.thread_id,
    runId: raw.run_id,
    seq: raw.seq,
    seqInThread: raw.seq_in_thread ?? null,
    role: raw.role,
    data: raw.data ?? {},
    createdAt: raw.created_at ?? new Date().toISOString(),
  };
}

function mapBackendToolCall(raw: any): ThreadToolCall {
  return {
    id: raw.id ?? `${raw.message_id}:${raw.llm_call_id ?? raw.id}`,
    threadId: raw.thread_id,
    runId: raw.run_id,
    messageId: raw.message_id,
    callSeq: raw.call_seq,
    llmCallId: raw.llm_call_id,
    toolName: raw.tool_name,
    arguments: raw.arguments ?? {},
    status: parseThreadToolCallStatus(raw.status),
    reason: raw.reason ?? null,
    result: raw.result ?? null,
    childRunId: raw.child_run_id ?? null,
    childThreadId: raw.child_thread_id ?? null,
    acceptedAt: raw.accepted_at ?? null,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? new Date().toISOString(),
  };
}

function mapBackendThread(raw: any): ThreadInfo {
  return {
    id: raw.id,
    projectId: raw.project_id,
    threadType: raw.thread_type,
    ownerId: raw.owner_id ?? null,
    journeyKind: raw.journey_kind ?? null,
    status: raw.status,
    lastError: null,
  };
}

function normalizeUnknownError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);
  return new Error(fallback);
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function normalizeErrorText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const combined = value
      .map((item) => normalizeErrorText(item))
      .filter((item): item is string => Boolean(item))
      .join(', ');
    return combined || null;
  }
  if (value && typeof value === 'object') {
    const message = normalizeErrorText((value as any).message);
    if (message) return message;
    const detail = normalizeErrorText((value as any).detail);
    if (detail) return detail;
    const error = normalizeErrorText((value as any).error);
    if (error) return error;
  }
  return null;
}

// ── Orchestrator class ──

export class ThreadOrchestrator {
  private streamByThread = new Map<string, StreamHandle>();
  private deltaMessageIdByThread = new Map<string, string>();
  private lastEventSeqByThread = new Map<string, number>();
  private resumeInFlightByThread = new Set<string>();
  private pendingUserMessageByClientId = new Map<string, PendingUserMessageRef>();
  private pendingClientMessageIdByRun = new Map<string, string>();
  // Track which run_id corresponds to which thread for SSE purposes
  private runIdToThread = new Map<string, string>();

  // ── Public API ──

  async dispatch(input: {
    projectId: string;
    threadType: 'agent' | 'subAgent' | 'journey';
    threadId?: string;
    inputText: string;
    language: string;
    runMode?: string;
    surface?: string;
    contextObjectIds?: string[];
    journeyKind?: string;
    inputPayload?: Record<string, unknown>;
    journeyTargetIds?: string[];
    signal?: AbortSignal;
    afterSeq?: number;
  }): Promise<{ threadId: string }> {
    const store = useThreadStore.getState();
    let resolvedThreadId = input.threadId ?? '';
    const shouldTrackClientMessage =
      input.threadType !== 'journey' && input.inputText.trim().length > 0;
    const clientMessageId = shouldTrackClientMessage ? createClientMessageId() : undefined;
    const pendingMessageId =
      shouldTrackClientMessage && resolvedThreadId ? `pending:user:${clientMessageId}` : undefined;

    if (pendingMessageId && clientMessageId && resolvedThreadId) {
      store.appendMessage({
        id: pendingMessageId,
        threadId: resolvedThreadId,
        runId: '',
        seq: 0,
        seqInThread: null,
        role: 'user',
        data: {
          [input.language]: {
            contentParts: [{ type: 'content', text: input.inputText }],
            thinkingDetails: [],
          },
        },
        createdAt: new Date().toISOString(),
      });
      this.pendingUserMessageByClientId.set(clientMessageId, {
        threadId: resolvedThreadId,
        pendingMessageId,
      });
    }

    let handle!: StreamHandle;
    let streamAttached = false;
    try {
      handle = await threadService.dispatch(
        input.projectId,
        {
          thread_type: input.threadType,
          thread_id: input.threadId,
          input_text: input.inputText,
          language: input.language,
          client_message_id: clientMessageId,
          run_mode: input.runMode,
          surface: input.surface,
          context_object_ids: input.contextObjectIds,
          journey_kind: input.journeyKind,
          input_payload: input.inputPayload,
          journey_target_ids: input.journeyTargetIds,
        },
        (event) => {
          const threadId = this.resolveThreadIdFromEvent(event, resolvedThreadId);
          if (threadId && !resolvedThreadId) {
            resolvedThreadId = threadId;
          }
          if (threadId && !streamAttached) {
            this.abortPreviousStream(threadId);
            this.streamByThread.set(threadId, handle);
            this.attachStreamFailureHandler(threadId, handle, 'dispatch');
            streamAttached = true;
          }
          const runId = event.data?.run_id;
          if (runId && clientMessageId) {
            this.pendingClientMessageIdByRun.set(String(runId), clientMessageId);
          }
          if (resolvedThreadId) {
            this.handleEvent(resolvedThreadId, event);
          }
        },
        { signal: input.signal },
        input.afterSeq,
      );
    } catch (error) {
      if (clientMessageId) {
        this.removePendingUserMessage(clientMessageId);
      }
      throw error;
    }

    if (resolvedThreadId && !streamAttached) {
      this.abortPreviousStream(resolvedThreadId);
      this.streamByThread.set(resolvedThreadId, handle);
      this.attachStreamFailureHandler(resolvedThreadId, handle, 'dispatch');
      streamAttached = true;
    }

    if (!streamAttached) {
      void handle.done.catch((error) => {
        if (streamAttached) return;
        const normalized = normalizeUnknownError(error, 'Dispatch stream failed before thread binding.');
        if (isAbortLikeError(normalized)) return;
        if (clientMessageId) {
          this.removePendingUserMessage(clientMessageId);
        }
        console.error('ThreadOrchestrator.dispatch stream failed before thread binding:', normalized);
      });
    }

    return { threadId: resolvedThreadId };
  }

  async toolDecisions(input: {
    projectId: string;
    threadId: string;
    messageId: string;
    decisions: Record<string, 'accept' | 'reject' | 'cancel'>;
    options?: Record<string, unknown>;
    signal?: AbortSignal;
    afterSeq?: number;
  }): Promise<void> {
    if (!isUuid(input.messageId)) {
      throw new Error('message_id must be a valid UUID before applying tool decisions.');
    }
    const handle = await threadService.toolDecisions(
      input.projectId,
      input.threadId,
      {
        message_id: input.messageId,
        decisions: input.decisions,
        options: input.options,
      },
      (event) => this.handleEvent(input.threadId, event),
      { signal: input.signal },
      input.afterSeq ?? this.lastEventSeqByThread.get(input.threadId),
    );

    this.abortPreviousStream(input.threadId);
    this.streamByThread.set(input.threadId, handle);
    this.attachStreamFailureHandler(input.threadId, handle, 'toolDecisions');
  }

  async resume(input: {
    projectId: string;
    threadId: string;
    signal?: AbortSignal;
    afterSeq?: number;
  }): Promise<void> {
    const handle = await threadService.resume(
      input.projectId,
      input.threadId,
      (event) => this.handleEvent(input.threadId, event),
      { signal: input.signal },
      input.afterSeq ?? this.lastEventSeqByThread.get(input.threadId),
    );

    this.abortPreviousStream(input.threadId);
    this.streamByThread.set(input.threadId, handle);
    this.attachStreamFailureHandler(input.threadId, handle, 'resume');
  }

  async pause(projectId: string, threadId: string): Promise<void> {
    await threadService.pause(projectId, threadId);
    useThreadStore.getState().patchThread(threadId, { status: 'paused', lastError: null });
  }

  async cancel(projectId: string, threadId: string): Promise<void> {
    this.abortPreviousStream(threadId);
    await threadService.cancel(projectId, threadId);
    useThreadStore.getState().patchThread(threadId, { status: 'idle', lastError: null });
  }

  async recover(projectId: string, threadId: string): Promise<void> {
    const state = await threadService.getState(projectId, threadId);
    const store = useThreadStore.getState();

    if (state.thread) {
      store.upsertThread(mapBackendThread(state.thread));
    }

    if (state.messages) {
      store.replaceMessages(threadId, state.messages.map(mapBackendMessage));
    }

    if (state.tool_calls) {
      const byMessage = new Map<string, ThreadToolCall[]>();
      try {
        for (const raw of state.tool_calls) {
          const tc = mapBackendToolCall(raw);
          const existing = byMessage.get(tc.messageId) ?? [];
          existing.push(tc);
          byMessage.set(tc.messageId, existing);
        }
      } catch (error) {
        store.patchThread(threadId, { status: 'error' });
        throw error;
      }
      for (const [messageId, tcs] of byMessage) {
        store.upsertToolCalls(messageId, tcs);
      }
    }

    // If there's an active run, re-subscribe to its events
    if (state.open_run && state.open_run.status === 'running') {
      const runId = state.open_run.id;
      this.runIdToThread.set(runId, threadId);
    }
    if (state.open_run && state.open_run.status === 'error') {
      const recoveredError = normalizeErrorText(state.open_run.error) ?? 'An error occurred during generation.';
      store.patchThread(threadId, { status: 'error', lastError: recoveredError });
    }

  }

  // ── Event handling ──

  private handleEvent(threadId: string, event: ThreadEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    const eventSeq = data.event_seq;
    if (typeof eventSeq === 'number') {
      const last = this.lastEventSeqByThread.get(threadId) ?? 0;
      if (eventSeq <= last) return;
      this.lastEventSeqByThread.set(threadId, eventSeq);
    }

    // Track run_id → thread mapping
    const runId = data.run_id;
    if (runId) {
      this.runIdToThread.set(runId, threadId);
    }

    const store = useThreadStore.getState();
    const payload = data.payload ?? data;

    try {
      switch (event.event) {
      case 'run:status': {
        const status = payload.status;
        if (status) {
          const threadStatus = this.runStatusToThreadStatus(status);
          const statusPatch: Partial<ThreadInfo> = { status: threadStatus };
          if (threadStatus === 'error') {
            statusPatch.lastError = normalizeErrorText(payload.error) ?? 'An error occurred during generation.';
          } else {
            statusPatch.lastError = null;
          }
          store.patchThread(threadId, statusPatch);
        }
        if (['completed', 'error', 'cancelled'].includes(payload.status)) {
          if (runId) {
            this.clearPendingUserMessageForRun(runId);
          }
          this.clearPendingUserMessagesForThread(threadId);
          this.abortPreviousStream(threadId);
        }
        break;
      }

      case 'run:user_message_created': {
        const clientMessageId = typeof payload.client_message_id === 'string'
          ? payload.client_message_id
          : '';
        const rawMessage = payload.message;
        if (!rawMessage || typeof rawMessage !== 'object') {
          break;
        }

        const backendMessage = mapBackendMessage(rawMessage);
        const targetThreadId = backendMessage.threadId || threadId;
        const existingMessages = store.getMessages(targetThreadId);
        const hasBackendMessage = existingMessages.some((m) => m.id === backendMessage.id);
        const pending = clientMessageId ? this.consumePendingUserMessage(clientMessageId) : undefined;

        if (pending) {
          const pendingMessages = store.getMessages(pending.threadId);
          const hasPending = pendingMessages.some((m) => m.id === pending.pendingMessageId);
          if (hasPending) {
            if (hasBackendMessage) {
              store.removeMessage(pending.threadId, pending.pendingMessageId);
            } else {
              store.patchMessage(pending.threadId, pending.pendingMessageId, {
                id: backendMessage.id,
                threadId: backendMessage.threadId,
                runId: backendMessage.runId,
                seq: backendMessage.seq,
                seqInThread: backendMessage.seqInThread,
                role: backendMessage.role,
                data: backendMessage.data,
                createdAt: backendMessage.createdAt,
              });
            }
          } else if (!hasBackendMessage) {
            store.appendMessage(backendMessage);
          }
        } else if (!hasBackendMessage) {
          store.appendMessage(backendMessage);
        }
        break;
      }

      case 'run:llm_delta': {
        const deltaId = `delta:${threadId}`;
        const existingDelta = this.deltaMessageIdByThread.get(threadId);

        if (!existingDelta) {
          this.deltaMessageIdByThread.set(threadId, deltaId);
          store.appendMessage({
            id: deltaId,
            threadId,
            runId: runId ?? '',
            seq: 0,
            seqInThread: null,
            role: 'assistant',
            data: {
              _streaming: {
                contentParts: payload.content_delta ? [{ type: 'content', text: payload.content_delta }] : [],
                thinkingDetails: [],
              },
            },
            createdAt: new Date().toISOString(),
          });
        } else {
          const msgs = store.getMessages(threadId);
          const deltaMsg = msgs.find((m) => m.id === deltaId);
          if (deltaMsg) {
            const entry = deltaMsg.data._streaming ?? { contentParts: [], thinkingDetails: [] };
            const parts = [...(entry.contentParts ?? [])];
            if (payload.content_delta) {
              if (parts.length > 0 && parts[parts.length - 1].type === 'content') {
                parts[parts.length - 1] = {
                  ...parts[parts.length - 1],
                  text: parts[parts.length - 1].text + payload.content_delta,
                };
              } else {
                parts.push({ type: 'content', text: payload.content_delta });
              }
            }
            if (payload.thinking_delta) {
              if (parts.length > 0 && parts[parts.length - 1].type === 'thinking') {
                parts[parts.length - 1] = {
                  ...parts[parts.length - 1],
                  text: parts[parts.length - 1].text + payload.thinking_delta,
                };
              } else {
                parts.push({ type: 'thinking', text: payload.thinking_delta });
              }
            }
            store.patchMessage(threadId, deltaId, {
              data: { _streaming: { contentParts: parts, thinkingDetails: entry.thinkingDetails ?? [] } },
            });
          }
        }
        break;
      }

      case 'run:llm_final': {
        // Remove delta message
        const deltaId = this.deltaMessageIdByThread.get(threadId);
        if (deltaId) {
          store.removeMessage(threadId, deltaId);
          this.deltaMessageIdByThread.delete(threadId);
        }

        // Add final assistant message
        const msgId = payload.message_id;
        if (msgId) {
          const langKey = payload.language ?? '_final';
          store.appendMessage({
            id: msgId,
            threadId,
            runId: runId ?? '',
            seq: 0,
            seqInThread: null,
            role: 'assistant',
            data: {
              [langKey]: {
                contentParts: payload.content_parts ?? [],
                thinkingDetails: payload.thinking_details ?? [],
              },
            },
            createdAt: new Date().toISOString(),
          });

          // Signal that tool call cards are expected for this message
          if (payload.tool_calls?.length > 0) {
            store.setPendingToolCallMessage(threadId, msgId);
          }
        }
        break;
      }

      case 'run:tool_calls': {
        store.clearPendingToolCallMessage(threadId);
        const messageId = payload.message_id;
        const calls: ThreadToolCall[] = (payload.tool_calls ?? []).map((tc: any) => ({
          id: `${messageId}:${tc.id}`,
          threadId,
          runId: runId ?? '',
          messageId,
          callSeq: tc.call_seq ?? 0,
          llmCallId: tc.id,
          toolName: tc.tool_name,
          arguments: tc.arguments ?? {},
          status: parseThreadToolCallStatus(tc.status ?? 'pending'),
          reason: tc.reason ?? null,
          result: null,
          childRunId: null,
          acceptedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        store.upsertToolCalls(messageId, calls);
        break;
      }

      case 'run:tool_calls_executed': {
        const messageId = payload.message_id;
        const existing = store.getToolCalls(messageId);
        const updates: ThreadToolCall[] = (payload.tool_calls ?? []).map((tc: any) => {
          const prev = existing.find((e) => e.llmCallId === (tc.id ?? tc.llm_call_id));
          return {
            ...(prev ?? {
              id: `${messageId}:${tc.id ?? tc.llm_call_id}`,
              threadId,
              runId: runId ?? '',
              messageId,
              callSeq: 0,
              llmCallId: tc.id ?? tc.llm_call_id,
              toolName: tc.tool_name,
              arguments: {},
              createdAt: new Date().toISOString(),
            }),
            status: parseThreadToolCallStatus(tc.status),
            reason: tc.reason ?? null,
            result: tc.result ?? null,
            childRunId: tc.child_run_id ?? prev?.childRunId ?? null,
            childThreadId: tc.child_thread_id ?? prev?.childThreadId ?? null,
            updatedAt: new Date().toISOString(),
          } as ThreadToolCall;
        });
        store.upsertToolCalls(messageId, updates);
        break;
      }

      case 'run:complete': {
        store.patchThread(threadId, { status: 'idle', lastError: null });
        if (runId) {
          this.clearPendingUserMessageForRun(runId);
        }
        this.clearPendingUserMessagesForThread(threadId);
        this.abortPreviousStream(threadId);
        break;
      }

      case 'run:error': {
        const runError = normalizeErrorText(payload.error) ?? 'An error occurred during generation.';
        store.patchThread(threadId, { status: 'error', lastError: runError });
        if (runId) {
          this.clearPendingUserMessageForRun(runId);
        }
        this.clearPendingUserMessagesForThread(threadId);
        this.abortPreviousStream(threadId);
        break;
      }

      case 'run:child_start':
      case 'run:child_end':
      case 'run:child_waiting':
      case 'run:step_completed':
      case 'run:heartbeat':
        break;

      case 'run:tools_all_terminal': {
        const projectId = String(data.project_id ?? payload.project_id ?? '');
        if (!projectId) {
          throw new Error('Missing project_id on run:tools_all_terminal');
        }
        void this.autoResumeIfReady(projectId, threadId);
        break;
      }

      case 'run:prompt_prepared': {
        const requestMessages = Array.isArray(payload.request?.messages) ? payload.request.messages : [];
        const provider = payload.provider ?? 'unknown';
        const model = payload.model ?? 'unknown';
        console.groupCollapsed(
          `[Prompt Debug] ${provider}/${model}`,
        );
        console.log('threadId:', threadId, 'runId:', runId);
        console.log('rendered payload:', payload);
        console.groupEnd();
        break;
      }

      default:
        break;
      }
    } catch (error) {
      console.error('ThreadOrchestrator.handleEvent failed:', error);
      store.patchThread(threadId, {
        status: 'error',
        lastError: normalizeUnknownError(error, 'Failed to handle stream event.').message,
      });
      this.abortPreviousStream(threadId);
    }
  }

  // ── Internal helpers ──

  private resolveThreadIdFromEvent(event: ThreadEvent, fallback: string): string {
    const data = event.data;
    if (data && typeof data === 'object' && data.thread_id) {
      return data.thread_id;
    }
    return fallback;
  }

  private abortPreviousStream(threadId: string): void {
    const existing = this.streamByThread.get(threadId);
    if (existing) {
      try {
        existing.abort();
      } catch {
        // ignore
      }
      this.streamByThread.delete(threadId);
    }
  }

  private attachStreamFailureHandler(
    threadId: string,
    handle: StreamHandle,
    source: 'dispatch' | 'resume' | 'toolDecisions',
  ): void {
    void handle.done
      .catch((error) => {
        const normalized = normalizeUnknownError(error, `${source} stream failed.`);
        if (isAbortLikeError(normalized)) return;
        if (this.streamByThread.get(threadId) !== handle) return;

        console.error(`ThreadOrchestrator.${source} stream failed:`, {
          threadId,
          error: normalized,
        });
        useThreadStore.getState().patchThread(threadId, {
          status: 'error',
          lastError: normalized.message,
        });
        this.clearPendingUserMessagesForThread(threadId);
        try {
          handle.abort();
        } catch {
          // ignore
        }
        this.streamByThread.delete(threadId);
      })
      .finally(() => {
        if (this.streamByThread.get(threadId) === handle) {
          this.streamByThread.delete(threadId);
        }
      });
  }

  private runStatusToThreadStatus(runStatus: string): ThreadInfo['status'] {
    switch (runStatus) {
      case 'running':
        return 'running';
      case 'waiting':
        return 'waiting_tools';
      case 'paused':
        return 'paused';
      case 'error':
        return 'error';
      case 'completed':
      case 'cancelled':
        return 'idle';
      default:
        return 'idle';
    }
  }

  private removePendingUserMessage(clientMessageId: string): void {
    const pending = this.pendingUserMessageByClientId.get(clientMessageId);
    if (!pending) return;
    useThreadStore.getState().removeMessage(pending.threadId, pending.pendingMessageId);
    this.pendingUserMessageByClientId.delete(clientMessageId);
    for (const [runId, trackedClientMessageId] of this.pendingClientMessageIdByRun.entries()) {
      if (trackedClientMessageId === clientMessageId) {
        this.pendingClientMessageIdByRun.delete(runId);
      }
    }
  }

  private consumePendingUserMessage(clientMessageId: string): PendingUserMessageRef | undefined {
    const pending = this.pendingUserMessageByClientId.get(clientMessageId);
    if (!pending) return undefined;
    this.pendingUserMessageByClientId.delete(clientMessageId);
    for (const [runId, trackedClientMessageId] of this.pendingClientMessageIdByRun.entries()) {
      if (trackedClientMessageId === clientMessageId) {
        this.pendingClientMessageIdByRun.delete(runId);
      }
    }
    return pending;
  }

  private clearPendingUserMessageForRun(runId: string): void {
    const clientMessageId = this.pendingClientMessageIdByRun.get(runId);
    if (!clientMessageId) return;
    this.pendingClientMessageIdByRun.delete(runId);
    this.removePendingUserMessage(clientMessageId);
  }

  private clearPendingUserMessagesForThread(threadId: string): void {
    for (const [clientMessageId, pending] of this.pendingUserMessageByClientId.entries()) {
      if (pending.threadId !== threadId) continue;
      this.removePendingUserMessage(clientMessageId);
    }
  }

  private canAutoResumeThread(threadId: string): boolean {
    const store = useThreadStore.getState();
    const thread = store.getThread(threadId);
    if (!thread) return false;
    if (thread.status === 'running') return false;
    if (!['waiting_tools', 'paused', 'error'].includes(thread.status)) return false;

    const messages = [...store.getMessages(threadId)].sort((a, b) => {
      const aSeq = a.seqInThread ?? Number.MAX_SAFE_INTEGER;
      const bSeq = b.seqInThread ?? Number.MAX_SAFE_INTEGER;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.createdAt.localeCompare(b.createdAt);
    });
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return false;

    const toolCalls = store.getToolCalls(lastAssistant.id);
    if (!toolCalls.length) return false;
    return toolCalls.every((tc) => TERMINAL_TOOL_STATUSES.has(tc.status));
  }

  private async autoResumeIfReady(projectId: string, threadId: string): Promise<void> {
    if (this.resumeInFlightByThread.has(threadId)) return;
    if (!this.canAutoResumeThread(threadId)) return;

    this.resumeInFlightByThread.add(threadId);
    try {
      await this.resume({ projectId, threadId, afterSeq: this.lastEventSeqByThread.get(threadId) });
    } catch (error) {
      console.error('Auto-resume failed:', error);
      useThreadStore.getState().patchThread(threadId, { status: 'error' });
    } finally {
      this.resumeInFlightByThread.delete(threadId);
    }
  }
}

export const threadOrchestrator = new ThreadOrchestrator();
