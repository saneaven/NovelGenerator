import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessagesResponse } from '../../api/threadService';
import type { ThreadInfo, ThreadMessage } from '../../types/thread';

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
      status: 'done',
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
  listMessagesMock.mockReset();
  queryClient.clear();
  useThreadStreamStore.getState().clearAll();
});

describe('thread message snapshot side effects', () => {
  it('does not overwrite an existing thread status from a message snapshot fetch', async () => {
    useThreadStreamStore.getState().upsertThread(makeThread({ status: 'running', latestRunStatus: 'running' }));
    listMessagesMock.mockResolvedValueOnce(makeResponse({
      thread: makeThread({ status: 'ready', latestRunStatus: 'ready' }),
    }));

    await refetchThreadSnapshot(threadId);

    expect(useThreadStreamStore.getState().threadsById[threadId]?.status).toBe('running');
    expect(useThreadStreamStore.getState().threadsById[threadId]?.latestRunStatus).toBe('running');
  });

  it('hydrates latest run context for an existing thread without changing live status', async () => {
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
    expect(thread?.status).toBe('running');
    expect(thread?.latestRunStatus).toBe('running');
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

  it('does not clear stream-active state during a message snapshot fetch', async () => {
    const store = useThreadStreamStore.getState();
    store.upsertThread(makeThread({ status: 'running', latestRunStatus: 'running' }));
    store.setThreadStreamActive(threadId, true);
    listMessagesMock.mockResolvedValueOnce(makeResponse());

    await refetchThreadSnapshot(threadId);

    expect(useThreadStreamStore.getState().activeStreamByThread[threadId]).toBe(true);
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
