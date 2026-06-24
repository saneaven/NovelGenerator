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

import { mergeThreadMessages } from './useThreadView';

const threadId = 'thread-1';
const runId = 'run-1';

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
    createdAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeThreadMessages', () => {
  it('keeps a streaming overlay over a snapshot placeholder with the same id', () => {
    const placeholder = makeMessage({
      data: {
        English: {
          contentParts: [],
        },
      },
      isStreaming: false,
    });
    const streaming = makeMessage({
      isStreaming: true,
      streamingData: {
        contentParts: [{ type: 'content', text: 'streaming text' }],
      },
    });

    const [merged] = mergeThreadMessages([placeholder], [streaming]);

    expect(merged).toBe(streaming);
    expect(merged.isStreaming).toBe(true);
    expect(merged.streamingData?.contentParts[0]?.text).toBe('streaming text');
  });

  it('keeps finalized snapshot truth over a non-streaming overlay with the same id', () => {
    const finalized = makeMessage({
      data: {
        English: {
          contentParts: [{ type: 'content', text: 'final text' }],
        },
      },
      isStreaming: false,
    });
    const nonStreamingOverlay = makeMessage({
      data: {
        English: {
          contentParts: [{ type: 'content', text: 'overlay text' }],
        },
      },
      isStreaming: false,
    });

    const [merged] = mergeThreadMessages([finalized], [nonStreamingOverlay]);

    expect(merged).toBe(finalized);
    expect(merged.data.English.contentParts[0]?.text).toBe('final text');
  });
});
