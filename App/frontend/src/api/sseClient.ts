import { API_BASE_URL, apiClient } from './client';
import type { RunStatus, ToolCallStatus } from '../types/thread';
import type { AnyObjectType, ObjectType } from '../types/unifiedObject';
import type { NotificationDTO } from './notificationService';
import type { ImageRun, ImageRunStage, ImageRunStatus } from './assetService';

interface RuntimeEventBase {
  project_id: string | null;
  thread_id: string;
  run_id: string | null;
  ts: string;
  thread_type?: string;
}

export interface ObjectChangedChange {
  action: 'created' | 'updated' | 'deleted';
  object_type: AnyObjectType;
  object_id: string;
}

export interface ObjectChangedEventData {
  project_id: string;
  ts: string;
  batch_id: string;
  changes: ObjectChangedChange[];
}

export type ObjectChangedEvent = {
  event: 'object:changed';
  data: ObjectChangedEventData;
};

export type AssetChangedChange =
  | { scope: 'project_assets'; action: 'created' | 'updated' | 'deleted' }
  | { scope: 'object_asset_links'; action: 'created' | 'updated' | 'deleted'; object_type: ObjectType; object_id: string }
  | { scope: 'scene_assets'; action: 'created' | 'updated' | 'deleted'; manuscript_id: string | null };

export interface AssetChangedEventData {
  project_id: string;
  ts: string;
  batch_id: string;
  changes: AssetChangedChange[];
}

export type AssetChangedEvent = {
  event: 'asset:changed';
  data: AssetChangedEventData;
};

export type ThreadRuntimeEvent =
  | { event: 'run:status'; data: RuntimeEventBase & { status: RunStatus; error?: string | null } }
  | { event: 'thread:snapshot_invalidated'; data: RuntimeEventBase }
  | { event: 'message:user'; data: RuntimeEventBase & { message_id: string; role: 'user'; seq: number; seq_in_thread: number; data: Record<string, unknown>; attachments?: Record<string, unknown>[] } }
  | { event: 'message:start'; data: RuntimeEventBase & { request_id?: string; message_id: string; role: 'assistant'; seq: number; seq_in_thread: number } }
  | { event: 'content:delta'; data: RuntimeEventBase & { request_id?: string; message_id: string; text: string } }
  | { event: 'thinking:delta'; data: RuntimeEventBase & { request_id?: string; message_id: string; text: string; thinking_display: string } }
  | { event: 'tool_call:start'; data: RuntimeEventBase & { request_id?: string; stream_key: string; tool_call_id: string; message_id: string; assistant_message_id: string; index?: number | null; name: string } }
  | { event: 'tool_call:delta'; data: RuntimeEventBase & { request_id?: string; stream_key: string; tool_call_id: string; index?: number | null; arguments_delta: string; name?: string } }
  | { event: 'tool_call:end'; data: RuntimeEventBase & { stream_key?: string; tool_call_id: string; message_id: string; assistant_message_id: string; index?: number | null; name: string; arguments: Record<string, unknown>; extra_content?: Record<string, unknown> | null; status?: ToolCallStatus } }
  | { event: 'tool_call:status'; data: RuntimeEventBase & {
      tool_call_id: string;
      status: ToolCallStatus;
      reason?: string | null;
      result?: Record<string, unknown> | null;
      extra_content?: Record<string, unknown> | null;
      image_run_id?: string | null;
      assistant_message_id?: string | null;
      child_thread_id?: string | null;
    } }
  | { event: 'message:update'; data: RuntimeEventBase & { message_id: string; data: Record<string, unknown> } }
  | { event: 'message:error'; data: RuntimeEventBase & { request_id?: string; message_id: string; error: string } }
  | { event: 'message:end'; data: RuntimeEventBase & {
      request_id?: string;
      message_id: string;
      seq_in_thread: number;
      data: Record<string, unknown>;
      tool_calls?: Array<{
        tool_call_id: string;
        message_id: string;
        assistant_message_id: string;
        index: number;
        name: string;
        arguments: Record<string, unknown>;
        extra_content?: Record<string, unknown> | null;
        status: string;
        reason?: string | null;
        seq_in_thread: number;
      }>;
    } }
  | { event: 'run:done'; data: RuntimeEventBase & { final_status: RunStatus } }
  | { event: 'run:error'; data: RuntimeEventBase & { error: string } }
  | { event: 'run:canceled'; data: RuntimeEventBase }
  | { event: 'llm:request'; data: RuntimeEventBase & {
      request_id?: string;
      retry_count?: number;
      message_id: string;
      provider: string;
      model: string;
    }}
  | { event: 'llm:response'; data: RuntimeEventBase & {
      request_id?: string;
      message_id: string;
      provider: string;
      model: string;
    }}
  | { event: string; data: Record<string, unknown> };

export type NotificationUpsertEvent = {
  event: 'notification:upsert';
  data: NotificationDTO & { ts: string };
};

export type NotificationDeleteEvent = {
  event: 'notification:delete';
  data: {
    id: string;
    project_id?: string | null;
    ts: string;
  };
};

export type NotificationBulkDeleteEvent = {
  event: 'notification:bulk_delete';
  data: {
    ids: string[];
    project_id?: string | null;
    ts: string;
  };
};

export type NotificationSSEEvent =
  | NotificationUpsertEvent
  | NotificationDeleteEvent
  | NotificationBulkDeleteEvent;

export type ImageRunUpdateEvent = {
  event: 'image_run:update';
  data: ImageRun & {
    project_id: string;
    ts: string;
    status: ImageRunStatus;
    stage: ImageRunStage;
  };
};

export type ThreadDeleteEvent = {
  event: 'thread:delete';
  data: {
    id: string;
    project_id: string;
    ts: string;
  };
};

export type ThreadBulkDeleteEvent = {
  event: 'thread:bulk_delete';
  data: {
    ids: string[];
    project_id: string;
    ts: string;
  };
};

export type ThreadDeletionSSEEvent = ThreadDeleteEvent | ThreadBulkDeleteEvent;

export type RuntimeSSEEvent =
  | AssetChangedEvent
  | ObjectChangedEvent
  | ThreadRuntimeEvent
  | NotificationSSEEvent
  | ImageRunUpdateEvent
  | ThreadDeletionSSEEvent;
export type ProjectSSEEvent = RuntimeSSEEvent;

interface ConnectOptions {
  onReconnect?: () => Promise<void> | void;
  onActivity?: () => void;
}

const STREAM_CURSOR_KEY = 'userStreamCursor';
const VISIBLE_STREAM_READ_TIMEOUT_MS = 30_000;

function readStreamCursor(): number | null {
  try {
    const raw = sessionStorage.getItem(STREAM_CURSOR_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStreamCursor(eventId: number): void {
  if (!Number.isInteger(eventId) || eventId < 0) return;
  try {
    sessionStorage.setItem(STREAM_CURSOR_KEY, String(eventId));
  } catch {
    // ignore storage errors
  }
}

function buildStreamUrl(afterEventId: number | null): string {
  const params = new URLSearchParams();
  if (afterEventId !== null) {
    params.set('after_event_id', String(afterEventId));
  } else {
    params.set('start_from', 'latest');
  }
  return `${API_BASE_URL}/api/v1/stream?${params.toString()}`;
}

type ParsedSseFrame = {
  event: RuntimeSSEEvent;
  eventId: number | null;
};

function parseSseFrame(frame: string): ParsedSseFrame | null {
  const lines = frame
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith(':'));

  if (lines.length === 0) return null;

  let eventName = 'message';
  let eventId: number | null = null;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('id:')) {
      const raw = line.slice(3).trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        eventId = parsed;
      }
      continue;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;

  const payload = dataLines.join('\n');
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      event: { event: eventName, data: parsed } as RuntimeSSEEvent,
      eventId,
    };
  } catch (error) {
    console.warn('Discarding malformed SSE payload', { eventName, payload, error });
    return null;
  }
}

function reconnectDelayMs(attempt: number): number {
  const capped = Math.min(attempt, 6);
  return 300 * (2 ** capped);
}

class RuntimeStreamReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out waiting for SSE activity after ${timeoutMs}ms`);
    this.name = 'RuntimeStreamReadTimeoutError';
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError';
}

function isDocumentVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function readChunkWithVisibleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (typeof document === 'undefined') {
    return reader.read();
  }

  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let remainingVisibleMs = VISIBLE_STREAM_READ_TIMEOUT_MS;
    let visibleSince: number | null = isDocumentVisible() ? Date.now() : null;

    const cleanup = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      signal.removeEventListener('abort', onAbort);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const resolveOnce = (value: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const armTimeout = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (!isDocumentVisible()) {
        visibleSince = null;
        return;
      }
      if (remainingVisibleMs <= 0) {
        void reader.cancel('Timed out waiting for runtime SSE activity');
        rejectOnce(new RuntimeStreamReadTimeoutError(VISIBLE_STREAM_READ_TIMEOUT_MS));
        return;
      }

      visibleSince = Date.now();
      timerId = setTimeout(() => {
        timerId = null;
        if (!isDocumentVisible()) {
          visibleSince = null;
          return;
        }
        remainingVisibleMs = 0;
        void reader.cancel('Timed out waiting for runtime SSE activity');
        rejectOnce(new RuntimeStreamReadTimeoutError(VISIBLE_STREAM_READ_TIMEOUT_MS));
      }, remainingVisibleMs);
    };

    const onAbort = () => {
      rejectOnce(createAbortError());
    };

    const onVisibilityChange = () => {
      if (isDocumentVisible()) {
        armTimeout();
        return;
      }

      if (visibleSince !== null) {
        remainingVisibleMs = Math.max(0, remainingVisibleMs - (Date.now() - visibleSince));
        visibleSince = null;
      }
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    armTimeout();

    reader.read().then(resolveOnce, rejectOnce);
  });
}

async function openAndReadStream(
  url: string,
  signal: AbortSignal,
  onEvent: (event: RuntimeSSEEvent, eventId: number | null) => void,
  options?: ConnectOptions,
): Promise<void> {
  const token = apiClient.getAuthToken();
  const headers: HeadersInit = {
    Accept: 'text/event-stream',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE stream failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('SSE stream body is empty');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await readChunkWithVisibleTimeout(reader, signal);
      if (done) break;
      if (!value || value.length === 0) continue;

      options?.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseFrame(frame);
        if (event) onEvent(event.event, event.eventId);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore stream cleanup failures
    }
  }
}

export async function connectUserStream(
  onEvent: (event: RuntimeSSEEvent) => void,
  signal: AbortSignal,
  options?: ConnectOptions,
): Promise<void> {
  let lastEventId = readStreamCursor();
  let attempt = 0;

  while (!signal.aborted) {
    try {
      let receivedActivity = false;
      const streamUrl = buildStreamUrl(lastEventId);
      await openAndReadStream(
        streamUrl,
        signal,
        (event, eventId) => {
          if (eventId !== null) {
            lastEventId = eventId;
            writeStreamCursor(eventId);
          }
          onEvent(event);
        },
        {
          onActivity: () => {
            receivedActivity = true;
            options?.onActivity?.();
          },
        },
      );
      if (signal.aborted) return;
      if (receivedActivity) {
        attempt = 0;
      } else {
        attempt += 1;
      }
      const delay = reconnectDelayMs(attempt);
      await sleepWithSignal(delay, signal);
      await options?.onReconnect?.();
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      attempt += 1;
      const delay = reconnectDelayMs(attempt);
      console.warn('Runtime SSE disconnected. Reconnecting...', {
        attempt,
        delay,
        error,
      });
      await sleepWithSignal(delay, signal);
      await options?.onReconnect?.();
    }
  }
}

export default connectUserStream;

