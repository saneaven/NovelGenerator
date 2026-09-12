import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectUserStream } from './sseClient';

vi.mock('./client', () => ({
  API_BASE_URL: 'https://test.invalid',
  apiClient: { getAuthToken: () => null },
}));

afterEach(() => vi.unstubAllGlobals());

function stubStream(frames: string): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  }))));
  return values;
}

describe('runtime event acknowledgements', () => {
  it('waits for each consumer before advancing its cursor or delivering the next event', async () => {
    const values = stubStream(
      'id: 1\nevent: content:delta\ndata: {"text":"one"}\n\n'
      + 'id: 2\nevent: content:delta\ndata: {"text":"two"}\n\n',
    );
    const controller = new AbortController();
    let releaseFirst!: () => void;
    const firstHandled = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const received: string[] = [];

    const task = connectUserStream(async (event) => {
      received.push(String((event.data as Record<string, unknown>).text));
      if (received.length === 1) {
        await firstHandled;
      } else {
        controller.abort();
      }
    }, controller.signal);

    await vi.waitFor(() => expect(received).toEqual(['one']));
    expect(values.get('userStreamCursor')).toBeUndefined();

    releaseFirst();
    await task;

    expect(received).toEqual(['one', 'two']);
    expect(values.get('userStreamCursor')).toBe('2');
  });

  it('does not acknowledge an event whose consumer rejects', async () => {
    const values = stubStream(
      'id: 5\nevent: tool_call:status\ndata: {"status":"applied"}\n\n'
      + 'id: 6\nevent: run:status\ndata: {"status":"running"}\n\n',
    );
    values.set('userStreamCursor', '4');
    const controller = new AbortController();
    const received: string[] = [];

    await connectUserStream(async (event) => {
      received.push(event.event);
      controller.abort();
      throw new Error('consumer failed');
    }, controller.signal);

    expect(received).toEqual(['tool_call:status']);
    expect(values.get('userStreamCursor')).toBe('4');
  });

  it('replays a failed first event instead of reconnecting from latest', async () => {
    const values = stubStream(
      'id: 5\nevent: tool_call:status\ndata: {"status":"applied"}\n\n',
    );
    const controller = new AbortController();
    let deliveryCount = 0;

    await connectUserStream(async () => {
      deliveryCount += 1;
      if (deliveryCount === 1) {
        throw new Error('retry this event');
      }
      controller.abort();
    }, controller.signal);

    expect(deliveryCount).toBe(2);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain('after_event_id=4');
    expect(values.get('userStreamCursor')).toBe('5');
  });
});
