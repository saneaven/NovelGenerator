import { describe, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '../../types/thread';

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

import { sortThreadMessages } from './useThreadView';

const threadId = 'thread-1';
const runId = 'run-1';

function makeMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm-1',
    threadId,
    runId,
    role: 'assistant',
    seq: 1,
    seqInThread: 1,
    data: { English: { contentParts: [] } },
    attachments: [],
    isStreaming: false,
    createdAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('sortThreadMessages', () => {
  it('orders by seqInThread ascending', () => {
    const a = makeMessage({ id: 'a', seqInThread: 2 });
    const b = makeMessage({ id: 'b', seqInThread: 1 });
    const c = makeMessage({ id: 'c', seqInThread: 3 });
    expect(sortThreadMessages([a, b, c]).map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks equal seqInThread by createdAt ascending', () => {
    const older = makeMessage({ id: 'z', seqInThread: 1, createdAt: '2026-06-24T00:00:00.000Z' });
    const newer = makeMessage({ id: 'a', seqInThread: 1, createdAt: '2026-06-24T00:00:01.000Z' });
    expect(sortThreadMessages([newer, older]).map((m) => m.id)).toEqual(['z', 'a']);
  });

  it('breaks fully-equal seq+createdAt by id (deterministic, no render-order flip)', () => {
    const m1 = makeMessage({ id: 'b', seqInThread: 1, createdAt: '2026-06-24T00:00:00.000Z' });
    const m2 = makeMessage({ id: 'a', seqInThread: 1, createdAt: '2026-06-24T00:00:00.000Z' });
    expect(sortThreadMessages([m1, m2]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [makeMessage({ id: 'a', seqInThread: 2 }), makeMessage({ id: 'b', seqInThread: 1 })];
    sortThreadMessages(input);
    expect(input.map((m) => m.id)).toEqual(['a', 'b']);
  });
});
