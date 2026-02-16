/**
 * Thread-centric orchestrator.
 *
 * Replaces RuntimeOrchestrator.ts — all operations keyed by threadId.
 * No run IDs exposed to callers (except internally for SSE subscriptions).
 */

import { type RequestOptions } from '../api/client';
import { threadService, type StreamHandle, type ThreadEvent } from '../api/threadService';
import {
  useThreadStore,
  type ThreadInfo,
  type ThreadMessage,
  type ThreadToolCall,
} from './store/threadStore';

// ── Helpers ──

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
    status: raw.status,
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
  };
}

// ── Orchestrator class ──

export class ThreadOrchestrator {
  private streamByThread = new Map<string, StreamHandle>();
  private deltaMessageIdByThread = new Map<string, string>();
  private lastEventSeqByThread = new Map<string, number>();
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

    const handle = await threadService.dispatch(
      input.projectId,
      {
        thread_type: input.threadType,
        thread_id: input.threadId,
        input_text: input.inputText,
        language: input.language,
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
        if (resolvedThreadId) {
          this.handleEvent(resolvedThreadId, event);
        }
      },
      { signal: input.signal },
      input.afterSeq,
    );

    if (resolvedThreadId) {
      this.abortPreviousStream(resolvedThreadId);
      this.streamByThread.set(resolvedThreadId, handle);
    }

    // If threadId wasn't known up front, we need to add user message
    if (input.inputText.trim() && resolvedThreadId) {
      const existing = store.getMessages(resolvedThreadId);
      const hasUserMsg = existing.some(
        (m) => m.role === 'user' && Object.values(m.data).some((e) =>
          e.contentParts?.some((p) => p.text === input.inputText),
        ),
      );
      if (!hasUserMsg) {
        store.appendMessage({
          id: `pending:user:${Date.now()}`,
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
      }
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
  }

  async pause(projectId: string, threadId: string): Promise<void> {
    await threadService.pause(projectId, threadId);
    useThreadStore.getState().patchThread(threadId, { status: 'paused' });
  }

  async cancel(projectId: string, threadId: string): Promise<void> {
    this.abortPreviousStream(threadId);
    await threadService.cancel(projectId, threadId);
    useThreadStore.getState().patchThread(threadId, { status: 'idle' });
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
      for (const raw of state.tool_calls) {
        const tc = mapBackendToolCall(raw);
        const existing = byMessage.get(tc.messageId) ?? [];
        existing.push(tc);
        byMessage.set(tc.messageId, existing);
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

    switch (event.event) {
      case 'run:status': {
        const status = payload.status;
        if (status) {
          const threadStatus = this.runStatusToThreadStatus(status);
          store.patchThread(threadId, { status: threadStatus });
        }
        if (['completed', 'error', 'cancelled'].includes(payload.status)) {
          this.abortPreviousStream(threadId);
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
          const langKey = '_final';
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
        }
        break;
      }

      case 'run:tool_calls': {
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
          status: tc.status ?? 'pending',
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
            status: tc.status,
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
        store.patchThread(threadId, { status: 'idle' });
        this.abortPreviousStream(threadId);
        break;
      }

      case 'run:error': {
        store.patchThread(threadId, { status: 'error' });
        this.abortPreviousStream(threadId);
        break;
      }

      case 'run:child_start':
      case 'run:child_end':
      case 'run:child_waiting':
      case 'run:tools_all_terminal':
      case 'run:step_completed':
      case 'run:heartbeat':
        break;

      default:
        break;
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
}

export const threadOrchestrator = new ThreadOrchestrator();
