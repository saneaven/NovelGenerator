import { API_BASE_URL, ApiError, apiClient, type RequestOptions } from './client';

export type RunExecutionEvent = {
  event: string;
  data: any;
};

export type StreamHandle = {
  done: Promise<void>;
  abort: () => void;
};

function buildPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/runs${suffix}`;
}

function withAfterSeq(path: string, afterSeq?: number): string {
  if (afterSeq == null || !Number.isFinite(afterSeq) || afterSeq < 0) {
    return path;
  }
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}after_seq=${Math.floor(afterSeq)}`;
}

function parseSseFrame(frame: string): RunExecutionEvent | null {
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
  onEvent: (event: RunExecutionEvent) => void,
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
      throw new ApiError(typeof detail === 'string' ? detail : 'Request failed', response.status, maybeJson);
    }

    if (!response.body) {
      return;
    }

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
        if (parsed) {
          onEvent(parsed);
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseFrame(buffer);
      if (parsed) {
        onEvent(parsed);
      }
    }
  })();

  return {
    done,
    abort: () => controller.abort(),
  };
}

export const runExecutionService = {
  startRun(
    projectId: string,
    payload: unknown,
    onEvent: (event: RunExecutionEvent) => void,
    requestOptions?: RequestOptions,
    afterSeq?: number,
  ) {
    return streamPostSse(withAfterSeq(buildPath(projectId, '/start'), afterSeq), payload, onEvent, requestOptions);
  },

  applyDecisions(
    projectId: string,
    runId: string,
    payload: unknown,
    onEvent: (event: RunExecutionEvent) => void,
    requestOptions?: RequestOptions,
    afterSeq?: number,
  ) {
    return streamPostSse(
      withAfterSeq(buildPath(projectId, `/${encodeURIComponent(runId)}/decisions`), afterSeq),
      payload,
      onEvent,
      requestOptions,
    );
  },

  resumeRun(
    projectId: string,
    runId: string,
    onEvent: (event: RunExecutionEvent) => void,
    requestOptions?: RequestOptions,
    afterSeq?: number,
  ) {
    return streamPostSse(
      withAfterSeq(buildPath(projectId, `/${encodeURIComponent(runId)}/resume`), afterSeq),
      {},
      onEvent,
      requestOptions,
    );
  },

  async pauseRun(projectId: string, runId: string): Promise<void> {
    await apiClient.post(buildPath(projectId, `/${encodeURIComponent(runId)}/pause`), {});
  },

  async cancelRun(projectId: string, runId: string): Promise<void> {
    await apiClient.post(buildPath(projectId, `/${encodeURIComponent(runId)}/cancel`), {});
  },

  async appendMessage(projectId: string, runId: string, payload: { text: string; language: string }): Promise<{ ok: boolean; message_id: string }> {
    return await apiClient.post(buildPath(projectId, `/${encodeURIComponent(runId)}/messages`), payload);
  },

  async getRun(projectId: string, runId: string): Promise<{ run: any }> {
    return await apiClient.get(buildPath(projectId, `/${encodeURIComponent(runId)}`));
  },

  async queryRuns(
    projectId: string,
    payload: { run_types?: Array<'agent' | 'subAgent' | 'journey'>; statuses?: string[]; limit?: number },
  ): Promise<{ items: any[] }> {
    return await apiClient.post(buildPath(projectId, '/query'), payload);
  },
};
