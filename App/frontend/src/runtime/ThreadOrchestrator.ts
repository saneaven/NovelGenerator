/**
 * Thread-centric orchestrator.
 *
 * All runtime operations are keyed by threadId.
 */

import { threadService, type StreamHandle, type ThreadEvent } from '../api/threadService';
import {
  useThreadStore,
  type ThreadInfo,
  type ThreadMessage,
  type ThreadToolCall,
} from './store/threadStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { toAutoApproveCategory } from '../toolCall/runtime/engine';
import { createClientMessageId, isUuid } from '../utils/idUtils';

// ── Helpers ──

type ThreadToolCallStatus = ThreadToolCall['status'];

const TERMINAL_TOOL_STATUSES: ReadonlySet<ThreadToolCallStatus> = new Set([
  'accepted',
  'rejected',
  'failed',
]);

function parseThreadToolCallStatus(raw: unknown): ThreadToolCallStatus {
  if (raw === 'pending' || raw === 'running' || raw === 'accepted' || raw === 'rejected' || raw === 'failed') {
    return raw;
  }
  throw new Error(`Invalid tool call status: ${String(raw)}`);
}

function lifecycleStatusToThreadStatus(status: string): ThreadInfo['status'] {
  switch (status) {
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

interface PendingUserMessageRef {
  threadId: string;
  pendingMessageId: string;
}

function mapBackendMessage(raw: any): ThreadMessage {
  return {
    id: raw.id,
    threadId: raw.thread_id,
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
    messageId: raw.message_id,
    callSeq: raw.call_seq,
    llmCallId: raw.llm_call_id,
    toolName: raw.tool_name,
    arguments: raw.arguments ?? {},
    status: parseThreadToolCallStatus(raw.status),
    reason: raw.reason ?? null,
    result: raw.result ?? null,
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
  private childToParentThread = new Map<string, { threadId: string; projectId: string; messageId: string }>();

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
    const dispatchAfterSeq = input.afterSeq ?? (
      resolvedThreadId ? this.lastEventSeqByThread.get(resolvedThreadId) : undefined
    );
    const shouldTrackClientMessage = input.threadType !== 'journey' && input.inputText.trim().length > 0;
    const clientMessageId = shouldTrackClientMessage ? createClientMessageId() : undefined;
    const pendingMessageId = shouldTrackClientMessage && resolvedThreadId ? `pending:user:${clientMessageId}` : undefined;

    if (pendingMessageId && clientMessageId && resolvedThreadId) {
      store.appendMessage({
        id: pendingMessageId,
        threadId: resolvedThreadId,
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
            useThreadStore.getState().setThreadStreamActive(threadId, true);
            this.attachStreamFailureHandler(threadId, handle, 'dispatch');
            streamAttached = true;
          }
          if (resolvedThreadId) {
            this.handleEvent(resolvedThreadId, event);
          }
        },
        { signal: input.signal },
        dispatchAfterSeq,
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
      useThreadStore.getState().setThreadStreamActive(resolvedThreadId, true);
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
  }): Promise<void> {
    if (!isUuid(input.messageId)) {
      throw new Error('message_id must be a valid UUID before applying tool decisions.');
    }

    const response = await threadService.toolDecisions(input.projectId, input.threadId, {
      message_id: input.messageId,
      decisions: input.decisions,
      options: input.options,
    });

    // Update store from PATCH response
    const store = useThreadStore.getState();
    const existing = store.getToolCalls(input.messageId);
    const updates: ThreadToolCall[] = (response.tool_calls ?? []).map((tc: any) => {
      const prev = existing.find((e) => e.llmCallId === tc.id);
      return {
        ...(prev ?? {
          id: `${input.messageId}:${tc.id}`,
          threadId: input.threadId,
          messageId: input.messageId,
          callSeq: 0,
          llmCallId: tc.id,
          toolName: tc.tool_name,
          arguments: {},
          createdAt: new Date().toISOString(),
        }),
        status: parseThreadToolCallStatus(tc.status),
        reason: tc.reason ?? null,
        result: tc.result ?? null,
        childThreadId: tc.child_thread_id ?? null,
        updatedAt: new Date().toISOString(),
      } as ThreadToolCall;
    });
    store.upsertToolCalls(input.messageId, updates);

    // Sync affected objects to unified store
    if (response.affected_objects?.length || response.deleted_ids?.length) {
      useUnifiedObjectStore.getState().applyAffectedObjects(
        (response.affected_objects ?? []) as any[],
        (response.deleted_ids ?? []).map((d) => d.id),
      );
    }

    // Register child threads + store child→parent mapping
    for (const tc of updates) {
      if (tc.childThreadId) {
        this.childToParentThread.set(tc.childThreadId, {
          threadId: input.threadId,
          projectId: input.projectId,
          messageId: input.messageId,
        });
        if (!store.getThread(tc.childThreadId)) {
          store.upsertThread({
            id: tc.childThreadId,
            projectId: input.projectId,
            threadType: 'subAgent',
            ownerId: null,
            journeyKind: null,
            status: 'running',
            lastError: null,
          });
        }
      }
    }

    // If all terminal → auto-resume parent immediately
    const allTerminal = updates.every((tc) => TERMINAL_TOOL_STATUSES.has(tc.status));
    if (allTerminal) {
      void this.autoResumeIfReady(input.projectId, input.threadId);
      return;
    }

    // If children running → subscribe to each child's events via resume SSE
    const runningChildren = updates.filter((tc) => tc.status === 'running' && tc.childThreadId);
    for (const tc of runningChildren) {
      void this.resume({
        projectId: input.projectId,
        threadId: tc.childThreadId!,
        afterSeq: undefined,
      });
    }
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
    useThreadStore.getState().setThreadStreamActive(input.threadId, true);
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

    // If an SSE stream is already active for this thread, don't overwrite
    // event seq tracking or stream-active state — the live stream handles this.
    // Without this guard, recover() racing with resume() would set lastEventSeqByThread
    // to a high value, causing the SSE backlog dedup check to filter out early events.
    const hasActiveStream = store.isThreadStreamActive(threadId);
    if (!hasActiveStream) {
      const recoveredEventSeq = typeof state.last_event_seq === 'number' ? state.last_event_seq : 0;
      this.lastEventSeqByThread.set(threadId, recoveredEventSeq);
    }

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

      // Create placeholder ThreadInfo for child threads so SubAgentPeekDock
      // can build childEntries (its lazy recovery will fetch full state).
      for (const raw of state.tool_calls) {
        const childId = raw.child_thread_id;
        if (childId && !store.getThread(childId)) {
          store.upsertThread({
            id: childId,
            projectId,
            threadType: 'subAgent',
            ownerId: null,
            journeyKind: null,
            status: 'idle',
            lastError: null,
          });
        }
      }
    }

    if (state.last_error) {
      store.patchThread(threadId, {
        status: 'error',
        lastError: normalizeErrorText(state.last_error) ?? 'An error occurred during generation.',
      });
    }
    if (!hasActiveStream) {
      store.setThreadStreamActive(threadId, false);
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

    const store = useThreadStore.getState();
    const payload = data.payload ?? data;

    try {
      switch (event.event) {
      case 'thread:status': {
        const status = payload.status;
        if (status) {
          const threadStatus = lifecycleStatusToThreadStatus(status);
          const statusPatch: Partial<ThreadInfo> = { status: threadStatus };
          if (threadStatus === 'error') {
            statusPatch.lastError = normalizeErrorText(payload.error) ?? 'An error occurred during generation.';
          } else {
            statusPatch.lastError = null;
          }
          store.patchThread(threadId, statusPatch);
        }
        if (['completed', 'error', 'cancelled'].includes(payload.status)) {
          this.clearPendingUserMessagesForThread(threadId);
          this.abortPreviousStream(threadId);
        }
        break;
      }

      case 'thread:user_message_created': {
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

      case 'thread:llm_delta': {
        const deltaId = `delta:${threadId}`;
        const existingDelta = this.deltaMessageIdByThread.get(threadId);

        if (!existingDelta) {
          this.deltaMessageIdByThread.set(threadId, deltaId);
          store.appendMessage({
            id: deltaId,
            threadId,
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

      case 'thread:llm_final': {
        const deltaId = this.deltaMessageIdByThread.get(threadId);
        if (deltaId) {
          store.removeMessage(threadId, deltaId);
          this.deltaMessageIdByThread.delete(threadId);
        }

        const msgId = payload.message_id;
        if (msgId) {
          const langKey = payload.language ?? '_final';
          store.appendMessage({
            id: msgId,
            threadId,
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

          if (payload.tool_calls?.length > 0) {
            store.setPendingToolCallMessage(threadId, msgId);
          }
        }
        break;
      }

      case 'thread:tool_calls': {
        store.clearPendingToolCallMessage(threadId);
        const messageId = payload.message_id;
        const calls: ThreadToolCall[] = (payload.tool_calls ?? []).map((tc: any) => ({
          id: `${messageId}:${tc.id}`,
          threadId,
          messageId,
          callSeq: tc.call_seq ?? 0,
          llmCallId: tc.id,
          toolName: tc.tool_name,
          arguments: tc.arguments ?? {},
          status: parseThreadToolCallStatus(tc.status ?? 'pending'),
          reason: tc.reason ?? null,
          result: null,
          acceptedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        store.upsertToolCalls(messageId, calls);

        // Auto-approve: if all pending calls match auto-approve policy, submit immediately
        const projectId = String(data.project_id ?? '');
        if (projectId) {
          const autoApprove = useSettingsStore.getState().settings?.toolCallAutoApprove;
          if (autoApprove) {
            const pending = calls.filter((c) => c.status === 'pending');
            if (pending.length > 0) {
              let allApprovable = true;
              const decisions: Record<string, 'accept'> = {};
              for (const call of pending) {
                const category = toAutoApproveCategory(call.toolName);
                if (!category || !autoApprove[category]) { allApprovable = false; break; }
                decisions[call.llmCallId] = 'accept';
              }
              if (allApprovable) {
                void this.toolDecisions({ projectId, threadId, messageId, decisions });
              }
            }
          }
        }
        break;
      }

      case 'thread:complete': {
        store.patchThread(threadId, { status: 'idle', lastError: null });
        this.clearPendingUserMessagesForThread(threadId);
        this.abortPreviousStream(threadId);

        // If this is a child thread → update parent tool call status
        const completeParentRef = this.childToParentThread.get(threadId);
        if (completeParentRef) {
          this.childToParentThread.delete(threadId);
          const parentCalls = store.getToolCalls(completeParentRef.messageId);
          const target = parentCalls.find((tc) => tc.childThreadId === threadId);
          if (target) {
            store.upsertToolCalls(completeParentRef.messageId, [{
              ...target,
              status: 'accepted' as const,
              updatedAt: new Date().toISOString(),
            }]);
          }
          void this.autoResumeIfReady(completeParentRef.projectId, completeParentRef.threadId);
        }
        break;
      }

      case 'thread:error': {
        const threadError = normalizeErrorText(payload.error) ?? 'An error occurred during generation.';
        store.patchThread(threadId, { status: 'error', lastError: threadError });
        this.clearPendingUserMessagesForThread(threadId);
        this.abortPreviousStream(threadId);

        // If this is a child thread → update parent tool call as cancelled
        const errorParentRef = this.childToParentThread.get(threadId);
        if (errorParentRef) {
          this.childToParentThread.delete(threadId);
          const parentCalls = store.getToolCalls(errorParentRef.messageId);
          const target = parentCalls.find((tc) => tc.childThreadId === threadId);
          if (target) {
            store.upsertToolCalls(errorParentRef.messageId, [{
              ...target,
              status: 'failed' as const,
              reason: 'Child sub-agent failed',
              updatedAt: new Date().toISOString(),
            }]);
          }
          void this.autoResumeIfReady(errorParentRef.projectId, errorParentRef.threadId);
        }
        break;
      }

      case 'thread:warning': {
        console.warn('[ThreadOrchestrator] Warning:', payload.message);
        break;
      }

      case 'thread:child_start':
      case 'thread:child_end':
      case 'thread:child_waiting':
      case 'thread:step_completed':
      case 'thread:heartbeat':
        break;

      case 'thread:tools_all_terminal': {
        const projectId = String(data.project_id ?? payload.project_id ?? '');
        if (!projectId) {
          throw new Error('Missing project_id on thread:tools_all_terminal');
        }
        void this.autoResumeIfReady(projectId, threadId);
        break;
      }

      case 'thread:prompt_prepared': {
        const provider = payload.provider ?? 'unknown';
        const model = payload.model ?? 'unknown';
        console.groupCollapsed(
          `[Prompt Debug] ${provider}/${model}`,
        );
        console.log('threadId:', threadId);
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
    useThreadStore.getState().setThreadStreamActive(threadId, false);
  }

  private attachStreamFailureHandler(
    threadId: string,
    handle: StreamHandle,
    source: 'dispatch' | 'resume',
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
        useThreadStore.getState().setThreadStreamActive(threadId, false);
      });
  }

  private removePendingUserMessage(clientMessageId: string): void {
    const pending = this.pendingUserMessageByClientId.get(clientMessageId);
    if (!pending) return;
    useThreadStore.getState().removeMessage(pending.threadId, pending.pendingMessageId);
    this.pendingUserMessageByClientId.delete(clientMessageId);
  }

  private consumePendingUserMessage(clientMessageId: string): PendingUserMessageRef | undefined {
    const pending = this.pendingUserMessageByClientId.get(clientMessageId);
    if (!pending) return undefined;
    this.pendingUserMessageByClientId.delete(clientMessageId);
    return pending;
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
    if (store.isThreadStreamActive(threadId)) return false;
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
