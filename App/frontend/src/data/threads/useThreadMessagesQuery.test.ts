import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessagesResponse } from '../../api/threadService';
import type { ThreadInfo, ThreadMessage } from '../../types/thread';
import type { ThreadRuntimeEvent } from '../../api/sseClient';
import { getThreadEventConsumer, disposeThreadEventConsumer } from '../../runtime/consumers/threadEventConsumer';
import { resetThreadReconciliation } from '../../runtime/threadReconciliation';

vi.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number;
    data?: unknown;

    constructor(message: string, status: number, data?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }

  return { ApiError };
});

vi.mock('../../api/threadService', () => ({
  threadService: {
    listMessages: vi.fn(),
  },
}));

import { threadService } from '../../api/threadService';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { queryClient } from '../queryClient';
import {
  refetchThreadSnapshot,
  ensureStreamingMessageInCache,
  readThreadSnapshotFromCache,
} from './useThreadMessagesQuery';

const threadId = 'thread-1';
const projectId = 'project-1';
const runId = 'run-1';

const listMessagesMock = vi.mocked(threadService.listMessages);

function makeThread(overrides: Partial<ThreadInfo> = {}): ThreadInfo {
  return {
    id: threadId,
    projectId,
    threadType: 'agent',
    parentId: null,
    journeyKind: null,
    displayLabel: null,
    status: 'done',
    lastError: null,
    updatedAt: '2026-06-24T00:00:00.000Z',
    latestRunId: runId,
    latestRunStatus: 'done',
    latestMessageAt: null,
    unresolvedToolCallCount: 0,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'assistant-1',
    threadId,
    runId,
    role: 'assistant',
    seq: 1,
    seqInThread: 1,
    data: {
      English: {
        contentParts: [],
      },
    },
    attachments: [],
    isStreaming: false,
    createdAt: '2026-06-24T00:00:01.000Z',
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ThreadMessagesResponse> = {}): ThreadMessagesResponse {
  return {
    thread: makeThread(),
    latestRun: {
      id: runId,
      status: overrides.thread?.latestRunStatus ?? 'done',
      runSeq: 1,
      language: 'English',
      runMode: 'agentMode',
      surface: 'thread',
      createdAt: '2026-06-24T00:00:00.000Z',
      updatedAt: '2026-06-24T00:00:01.000Z',
      inputPayload: { source: 'test' },
      contextObjectIds: ['object-1'],
      journeyTargetIds: ['journey-1'],
    },
    messages: [],
    toolCalls: [],
    imageRuns: [],
    ...overrides,
  };
}

afterEach(() => {
  disposeThreadEventConsumer();
  resetThreadReconciliation();
  listMessagesMock.mockReset();
  queryClient.clear();
  useThreadStreamStore.getState().clearAll();
});

function event(name: string, data: Record<string, unknown> = {}): ThreadRuntimeEvent {
  return { event: name, data: { thread_id: threadId, run_id: runId, message_id: 'assistant-1',
    request_id: 'request-1', project_id: projectId, ...data } } as ThreadRuntimeEvent;
}

describe('reconnect snapshot ordering', () => {
  it('replaces a snapshot from a previous stream even when the new cursor is lower', async () => {
    listMessagesMock.mockResolvedValueOnce(makeResponse({ snapshotEventId: 100, messages: [makeMessage()] }));
    await refetchThreadSnapshot(threadId);
    resetThreadReconciliation();
    listMessagesMock.mockResolvedValueOnce(makeResponse({ snapshotEventId: 2, messages: [makeMessage({ id: 'new-message' })] }));
    await refetchThreadSnapshot(threadId);
    expect(readThreadSnapshotFromCache(threadId).version).toBe(2);
    expect(readThreadSnapshotFromCache(threadId).messages.map((message) => message.id)).toEqual(['new-message']);
  });

  it('restores the missing stream prefix and applies only the buffered new tail', async () => {
    let resolve!: (response: ThreadMessagesResponse) => void;
    listMessagesMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const loading = refetchThreadSnapshot(threadId);
    await vi.waitFor(() => expect(listMessagesMock).toHaveBeenCalled());
    const consumer = getThreadEventConsumer();
    consumer.consume(event('content:delta', { event_id: 2, text: 'Hello' }));
    consumer.consume(event('content:delta', { event_id: 3, text: ' world' }));
    resolve(makeResponse({
      thread: makeThread({ status: 'running', latestRunStatus: 'running' }),
      snapshotEventId: 2,
      messages: [makeMessage({ isStreaming: true })],
      streamEvents: [event('message:start', { seq: 1, seq_in_thread: 1 }), event('content:delta', { text: 'Hello' })],
    }));
    await loading;
    const snapshot = readThreadSnapshotFromCache(threadId);
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].streamingData?.contentParts).toEqual([{ type: 'content', text: 'Hello world' }]);
    expect(snapshot.version).toBe(3);
    consumer.consume(event('content:delta', { event_id: 3, text: ' world' }));
    expect(readThreadSnapshotFromCache(threadId).messages[0].streamingData?.contentParts).toEqual([{ type: 'content', text: 'Hello world' }]);
  });

  it('does not let an older status or run clear the current stream', () => {
    useThreadStreamStore.getState().upsertThread(makeThread({
      status: 'running', latestRunStatus: 'running', latestRunSeq: 2,
      latestRunUpdatedAt: '2026-06-24T00:00:02.000002',
    }));
    useThreadStreamStore.getState().setThreadStreamActive(threadId, true);
    const consumer = getThreadEventConsumer();
    consumer.consume(event('run:done', { event_id: 10, run_seq: 2, run_updated_at: '2026-06-24T00:00:02.000001', final_status: 'ready' }));
    consumer.consume(event('run:done', { event_id: 11, run_id: 'old-run', run_seq: 1, final_status: 'done' }));
    expect(useThreadStreamStore.getState().threadsById[threadId]?.status).toBe('running');
    expect(useThreadStreamStore.getState().activeStreamByThread[threadId]).toBe(true);
  });
});

describe('thread message snapshot side effects', () => {
  it('restores existing thread status from the server snapshot', async () => {
    useThreadStreamStore.getState().upsertThread(makeThread({ status: 'running', latestRunStatus: 'running' }));
    listMessagesMock.mockResolvedValueOnce(makeResponse({
      thread: makeThread({ status: 'ready', latestRunStatus: 'ready' }),
    }));

    await refetchThreadSnapshot(threadId);

    expect(useThreadStreamStore.getState().threadsById[threadId]?.status).toBe('ready');
    expect(useThreadStreamStore.getState().threadsById[threadId]?.latestRunStatus).toBe('ready');
  });

  it('hydrates latest run context and server runtime together', async () => {
    useThreadStreamStore.getState().upsertThread(makeThread({
      status: 'running',
      latestRunStatus: 'running',
      latestRunContext: null,
    }));
    listMessagesMock.mockResolvedValueOnce(makeResponse({
      thread: makeThread({ status: 'ready', latestRunStatus: 'ready' }),
    }));

    await refetchThreadSnapshot(threadId);

    const thread = useThreadStreamStore.getState().threadsById[threadId];
    expect(thread?.status).toBe('ready');
    expect(thread?.latestRunStatus).toBe('ready');
    expect(thread?.latestRunContext).toEqual({
      inputPayload: { source: 'test' },
      contextObjectIds: ['object-1'],
      journeyTargetIds: ['journey-1'],
      language: 'English',
      runMode: 'agentMode',
      surface: 'thread',
    });
  });

  it('refetch replaces the in-cache streaming row with server truth (heal)', async () => {
    useThreadStreamStore.getState().upsertThread(makeThread({ status: 'running', latestRunStatus: 'running' }));
    // The streaming row lives in the cache — the single source of truth.
    ensureStreamingMessageInCache(threadId, 'assistant-1', runId);
    expect(readThreadSnapshotFromCache(threadId).messages.find((m) => m.id === 'assistant-1')?.isStreaming).toBe(true);

    listMessagesMock.mockResolvedValueOnce(makeResponse({
      messages: [makeMessage({ id: 'assistant-1', isStreaming: false })],
    }));

    await refetchThreadSnapshot(threadId);

    const healed = readThreadSnapshotFromCache(threadId).messages.find((m) => m.id === 'assistant-1');
    expect(healed?.isStreaming).toBe(false);
  });

  it('clears stale stream-active state when the server snapshot has completed', async () => {
    const store = useThreadStreamStore.getState();
    store.upsertThread(makeThread({ status: 'running', latestRunStatus: 'running' }));
    store.setThreadStreamActive(threadId, true);
    listMessagesMock.mockResolvedValueOnce(makeResponse());

    await refetchThreadSnapshot(threadId);

    expect(useThreadStreamStore.getState().activeStreamByThread[threadId]).toBe(false);
  });

  it('seeds thread metadata and latest run context when the thread is absent', async () => {
    listMessagesMock.mockResolvedValueOnce(makeResponse({
      thread: makeThread({ status: 'ready', latestRunStatus: 'ready' }),
    }));

    await refetchThreadSnapshot(threadId);

    const thread = useThreadStreamStore.getState().threadsById[threadId];
    expect(thread?.status).toBe('ready');
    expect(thread?.latestRunContext).toEqual({
      inputPayload: { source: 'test' },
      contextObjectIds: ['object-1'],
      journeyTargetIds: ['journey-1'],
      language: 'English',
      runMode: 'agentMode',
      surface: 'thread',
    });
  });
});
