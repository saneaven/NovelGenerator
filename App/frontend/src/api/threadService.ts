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
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      const maybeJson = await response.json().catch(() => null);
      const detail = maybeJson?.detail ?? response.statusText ?? 'Request failed';
      throw new Error(typeof detail === 'string' ? detail : 'Request failed');
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
      decisions: Record<string, string>;
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
    open_run: any | null;
    messages: any[];
    tool_calls: any[];
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
