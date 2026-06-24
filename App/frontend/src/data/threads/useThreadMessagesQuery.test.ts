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
import { refetchThreadSnapshot } from './useThreadMessagesQuery';

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

  it('does not clear streaming overlay during a message snapshot fetch', async () => {
    const store = useThreadStreamStore.getState();
    store.upsertThread(makeThread({ status: 'running', latestRunStatus: 'running' }));
    store.ensureStreamingAssistantMessage({
      threadId,
      messageId: 'assistant-1',
      runId,
      seq: 1,
      seqInThread: 1,
    });
    listMessagesMock.mockResolvedValueOnce(makeResponse({
      messages: [makeMessage({ id: 'assistant-1' })],
    }));

    await refetchThreadSnapshot(threadId);

    const overlay = useThreadStreamStore.getState().overlayMessagesByThread[threadId] ?? [];
    expect(overlay.map((message) => message.id)).toContain('assistant-1');
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
