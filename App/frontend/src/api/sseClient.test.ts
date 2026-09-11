import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectUserStream } from './sseClient';

vi.mock('./client', () => ({
  API_BASE_URL: 'https://test.invalid',
  apiClient: { getAuthToken: () => null },
}));

afterEach(() => vi.unstubAllGlobals());

function stream(frames: string) {
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
    const values = stream('id: 1\nevent: content:delta\ndata: {"text":"one"}\n\nid: 2\nevent: content:delta\ndata: {"text":"two"}\n\n');
    const controller = new AbortController();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const received: unknown[] = [];
    const task = connectUserStream(async (event) => {
      received.push((event.data as Record<string, unknown>).event_id);
      if (received.length === 1) await first;
      else controller.abort();
    }, controller.signal);
    await vi.waitFor(() => expect(received).toEqual([1]));
    expect(values.get('userStreamCursor')).toBeUndefined();
    release();
    await task;
    expect(received).toEqual([1, 2]);
    expect(values.get('userStreamCursor')).toBe('2');
  });

  it('does not acknowledge a reset when snapshot restoration fails', async () => {
    const values = stream('id: 100\nevent: stream:reset\ndata: {}\n\n');
    values.set('userStreamCursor', '4');
    const controller = new AbortController();
    const consume = vi.fn();
    await connectUserStream(consume, controller.signal, {
      onReset: async () => {
        controller.abort();
        throw new Error('snapshot unavailable');
      },
    });
    expect(consume).not.toHaveBeenCalled();
    expect(values.get('userStreamCursor')).toBe('4');
  });
});
