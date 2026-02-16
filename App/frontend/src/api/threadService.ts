import { API_BASE_URL, apiClient, type RequestOptions } from './client';

export type ThreadEvent = {
  event: string;
  data: any;
};

export type StreamHandle = {
  done: Promise<void>;
  abort: () => void;
};

function buildPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/threads${suffix}`;
}

function withAfterSeq(path: string, afterSeq?: number): string {
  if (afterSeq == null || !Number.isFinite(afterSeq) || afterSeq < 0) {
    return path;
  }
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}after_seq=${Math.floor(afterSeq)}`;
}

function parseSseFrame(frame: string): ThreadEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  const lines = frame.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  let payload: any = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  return { event: eventName, data: payload };
}

function stringifyErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const normalized = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item ?? '').trim();
        const loc = Array.isArray((item as any).loc) ? (item as any).loc.join('.') : '';
        const msg = typeof (item as any).msg === 'string' ? (item as any).msg : '';
        if (loc && msg) return `${loc}: ${msg}`;
        return msg || loc;
      })
      .filter(Boolean)
      .join(', ');
    return normalized || null;
  }
  if (detail && typeof detail === 'object') {
    const maybeMessage = (detail as any).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
    const maybeDetail = (detail as any).detail;
    if (typeof maybeDetail === 'string' && maybeDetail.trim()) {
      return maybeDetail;
    }
  }
  return null;
}

function normalizeStreamError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  const detail = stringifyErrorDetail(error);
  if (detail) return new Error(detail);
  return new Error(fallback);
}

async function streamPostSse(
  path: string,
  body: unknown,
  onEvent: (event: ThreadEvent) => void,
  requestOptions?: RequestOptions,
): Promise<StreamHandle> {
  const controller = new AbortController();
  const externalSignal = requestOptions?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const token = apiClient.getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const done = (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        const maybeJson = await response.json().catch(() => null);
        const detail =
          stringifyErrorDetail((maybeJson as any)?.detail ?? maybeJson)
          ?? stringifyErrorDetail(response.statusText)
          ?? `Request failed (${response.status})`;
        throw new Error(detail);
      }

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) break;
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseFrame(frame);
          if (parsed) onEvent(parsed);
        }
      }

      if (buffer.trim()) {
        const parsed = parseSseFrame(buffer);
        if (parsed) onEvent(parsed);
      }
    } catch (error) {
      throw normalizeStreamError(error, 'Failed to stream thread response.');
    }
  })();

  return { done, abort: () => controller.abort() };
}

export const threadService = {
  dispatch(
    projectId: string,
    payload: {
      thread_type: string;
      thread_id?: string;
      input_text: string;
      language: string;
      client_message_id?: string;
      run_mode?: string;
      surface?: string;
      context_object_ids?: string[];
      journey_kind?: string;
      input_payload?: Record<string, unknown>;
      journey_target_ids?: string[];
    },
    onEvent: (event: ThreadEvent) => void,
    requestOptions?: RequestOptions,
    afterSeq?: number,
  ) {
    return streamPostSse(
      withAfterSeq(buildPath(projectId, '/dispatch'), afterSeq),
      payload,
      onEvent,
      requestOptions,
    );
  },

  toolDecisions(
    projectId: string,
    threadId: string,
    payload: {
      message_id: string;
      decisions: Record<string, 'accept' | 'reject' | 'cancel'>;
      options?: Record<string, unknown>;
    },
    onEvent: (event: ThreadEvent) => void,
    requestOptions?: RequestOptions,
    afterSeq?: number,
  ) {
    return streamPostSse(
      withAfterSeq(buildPath(projectId, `/${encodeURIComponent(threadId)}/tool-decisions`), afterSeq),
      payload,
      onEvent,
      requestOptions,
    );
  },

  resume(
    projectId: string,
    threadId: string,
    onEvent: (event: ThreadEvent) => void,
    requestOptions?: RequestOptions,
    afterSeq?: number,
  ) {
    return streamPostSse(
      withAfterSeq(buildPath(projectId, `/${encodeURIComponent(threadId)}/resume`), afterSeq),
      {},
      onEvent,
      requestOptions,
    );
  },

  async pause(projectId: string, threadId: string): Promise<void> {
    await apiClient.post(buildPath(projectId, `/${encodeURIComponent(threadId)}/pause`), {});
  },

  async cancel(projectId: string, threadId: string): Promise<void> {
    await apiClient.post(buildPath(projectId, `/${encodeURIComponent(threadId)}/cancel`), {});
  },

  async getState(projectId: string, threadId: string): Promise<{
    thread: any;
    messages: any[];
    tool_calls: any[];
    last_error: string | null;
    last_event_seq: number;
  }> {
    return await apiClient.get(buildPath(projectId, `/${encodeURIComponent(threadId)}/state`));
  },

  async patchMessage(
    projectId: string,
    threadId: string,
    messageId: string,
    data: { language: string; content_parts?: Array<Record<string, any>>; thinking_details?: Array<Record<string, any>> },
  ): Promise<any> {
    return apiClient.patch(
      buildPath(projectId, `/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`),
      data,
    );
  },

  async deleteMessage(projectId: string, threadId: string, messageId: string): Promise<void> {
    return apiClient.delete(
      buildPath(projectId, `/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`),
    );
  },
};
