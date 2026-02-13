import { type ConversationBlock, type ThinkingDetail } from './requestTypes';
import type { LLMStreamEvent, FinalSnapshot, StreamToolCallDelta } from './streamProtocol';
import {
  type ProviderType,
  type ProviderConfig,
  type ProviderPreference,
  type ThinkingConfig,
  type RetryConfig,
  type ThinkingFormat,
  type RequestFormat,
} from '../store/settingsStore';

import { apiClient, API_BASE_URL } from '../api/client';

const API_BASE = `${API_BASE_URL}/api/v1`;

function getAuthHeaders(): HeadersInit {
  const token = apiClient.getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BackendError extends Error {
  statusCode: number | null;
  detail: string | null;

  constructor(message: string, statusCode: number | null = null, detail: string | null = null) {
    super(message);
    this.name = 'BackendError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

type FrameSeparator = {
  index: number;
  length: number;
};

type ParsedSSEFrame = {
  eventName: string;
  payload: string;
};

function findSSEFrameSeparator(buffer: string): FrameSeparator | null {
  const lfIndex = buffer.indexOf('\n\n');
  const crlfIndex = buffer.indexOf('\r\n\r\n');

  if (lfIndex === -1 && crlfIndex === -1) {
    return null;
  }
  if (lfIndex === -1) {
    return { index: crlfIndex, length: 4 };
  }
  if (crlfIndex === -1) {
    return { index: lfIndex, length: 2 };
  }
  return lfIndex < crlfIndex
    ? { index: lfIndex, length: 2 }
    : { index: crlfIndex, length: 4 };
}

function normalizeSSEFrame(frame: string): string {
  return frame.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSSEFrame(rawFrame: string): ParsedSSEFrame | null {
  const frame = normalizeSSEFrame(rawFrame).trimEnd();
  if (!frame || frame.startsWith(':')) {
    return null;
  }

  const lines = frame.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('event:')) {
      const name = trimmed.slice(6).trim();
      if (name) {
        eventName = name;
      }
      continue;
    }

    if (trimmed.startsWith('data:')) {
      let payload = trimmed.slice(5);
      if (payload.startsWith(' ')) {
        payload = payload.slice(1);
      }
      dataLines.push(payload);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    eventName,
    payload: dataLines.join('\n').trim(),
  };
}

function parseJSONPayload(payload: string, eventName: string): any {
  try {
    return JSON.parse(payload);
  } catch {
    throw new BackendError(`Invalid JSON payload for SSE event '${eventName}'`, null, payload);
  }
}

function toDeltaEvent(data: any): LLMStreamEvent {
  const seq = typeof data?.seq === 'number' ? data.seq : 0;
  const contentDelta = typeof data?.contentDelta === 'string' ? data.contentDelta : null;
  const thinkingDelta = typeof data?.thinkingDelta === 'string' ? data.thinkingDelta : null;
  const toolCallDeltas: StreamToolCallDelta[] = Array.isArray(data?.toolCallDeltas)
    ? data.toolCallDeltas
    : [];
  const thinkingDetailsDelta: ThinkingDetail[] = Array.isArray(data?.thinkingDetailsDelta)
    ? data.thinkingDetailsDelta
    : [];

  return {
    type: 'delta',
    seq,
    contentDelta,
    thinkingDelta,
    toolCallDeltas,
    thinkingDetailsDelta,
  };
}

function toFinalEvent(data: any): LLMStreamEvent {
  const snapshot = data?.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new BackendError("Invalid 'final' event payload", null, JSON.stringify(data));
  }

  return {
    type: 'final',
    snapshot: snapshot as FinalSnapshot,
  };
}

function toErrorEvent(data: any): LLMStreamEvent {
  const message = typeof data?.message === 'string' ? data.message : 'Unknown backend error';
  const status = typeof data?.status === 'number' ? data.status : undefined;
  return {
    type: 'error',
    message,
    status,
  };
}

function toDoneEvent(data: any): LLMStreamEvent {
  return {
    type: 'done',
    ok: data?.ok === true,
  };
}

function parseProtocolEvent(eventName: string, payload: string): LLMStreamEvent | null {
  if (!payload) {
    return null;
  }

  if (!['delta', 'final', 'error', 'done'].includes(eventName)) {
    return null;
  }

  const data = parseJSONPayload(payload, eventName);
  if (eventName === 'delta') {
    return toDeltaEvent(data);
  }
  if (eventName === 'final') {
    return toFinalEvent(data);
  }
  if (eventName === 'error') {
    return toErrorEvent(data);
  }
  return toDoneEvent(data);
}

export async function* streamLLM(
  messages: ConversationBlock[],
  provider: ProviderType,
  providerConfig: ProviderConfig,
  opts?: {
    signal?: AbortSignal;
    temperature?: number;
    model?: string;
    max_tokens?: number;
    tools?: any[];
    tool_choice?: 'auto' | 'required' | 'none';
    provider_preference?: ProviderPreference;
    thinking_config?: ThinkingConfig;
    thinking_mode?: 'off' | 'custom' | 'model';
    thinking_format?: ThinkingFormat;
    request_format?: RequestFormat;
    retryConfig?: RetryConfig;
    native_tool_call?: boolean;
  }
): AsyncGenerator<LLMStreamEvent> {
  const endpoint = `${API_BASE}/chat/completions/${provider}/stream`;

  const backendConfig = {
    api_key: providerConfig.apiKey,
    base_url: providerConfig.baseUrl,
    additional_headers: providerConfig.additionalHeaders,
    additional_body: providerConfig.additionalBody,
  };

  const backendMessages = messages.map((message) => ({
    role: message.role,
    content_parts: message.contentParts,
    tool_calls: message.tool_calls,
    tool_results: message.tool_results,
  }));

  const requestBody: any = {
    messages: backendMessages,
    model: opts?.model || 'gpt-5',
    temperature: opts?.temperature ?? 0.7,
    provider_config: backendConfig,
  };

  if (typeof opts?.max_tokens === 'number') {
    requestBody.max_tokens = opts.max_tokens;
  }
  if (opts?.tools) {
    requestBody.tools = opts.tools;
  }
  if (opts?.tool_choice) {
    requestBody.tool_choice = opts.tool_choice;
  }
  if (provider === 'openrouter' && opts?.provider_preference) {
    requestBody.provider_preference = opts.provider_preference;
  }
  if (opts?.thinking_config) {
    requestBody.thinking_config = opts.thinking_config;
  }
  if (opts?.thinking_mode) {
    requestBody.thinking_mode = opts.thinking_mode;
  }
  if (opts?.thinking_format) {
    requestBody.thinking_format = opts.thinking_format;
  }
  if (opts?.request_format) {
    requestBody.request_format = opts.request_format;
  }
  if (opts?.native_tool_call === true) {
    requestBody.native_tool_call = true;
  }

  const retryConfig = opts?.retryConfig;
  const maxAttempts = retryConfig?.enabled && retryConfig?.maxRetries !== undefined
    ? retryConfig.maxRetries + 1
    : 1;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts?.signal?.aborted) {
      throw new Error('Request aborted');
    }

    let hasYieldedEvent = false;
    let res: Response | null = null;
    let lastFrame: string | null = null;
    let streamBuffer = '';

    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(requestBody),
        signal: opts?.signal,
      });

      if (!res.ok || !res.body) {
        const statusCode = res.status;
        const text = await res.text().catch(() => '');
        const errorMessage = text ? text : `HTTP ${res.status} ${res.statusText}`;
        throw new BackendError(`Backend Error (${statusCode}): ${errorMessage}`, statusCode);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let receivedDoneSignal = false;

      const processFrame = function* (rawFrame: string): Generator<LLMStreamEvent, void, unknown> {
        const parsed = parseSSEFrame(rawFrame);
        if (!parsed) {
          return;
        }

        lastFrame = normalizeSSEFrame(rawFrame).trimEnd();

        const event = parseProtocolEvent(parsed.eventName, parsed.payload);
        if (!event) {
          return;
        }

        hasYieldedEvent = true;
        if (event.type === 'done') {
          receivedDoneSignal = true;
        }
        yield event;
      };

      const drainBufferedFrames = function* (): Generator<LLMStreamEvent, void, unknown> {
        while (true) {
          const separator = findSSEFrameSeparator(streamBuffer);
          if (!separator) {
            return;
          }
          const frame = streamBuffer.slice(0, separator.index);
          streamBuffer = streamBuffer.slice(separator.index + separator.length);
          yield* processFrame(frame);
          if (receivedDoneSignal) {
            return;
          }
        }
      };

      const drainTrailingFrame = function* (): Generator<LLMStreamEvent, void, unknown> {
        if (!streamBuffer.trim()) {
          streamBuffer = '';
          return;
        }
        const trailingFrame = streamBuffer;
        streamBuffer = '';
        yield* processFrame(trailingFrame);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        streamBuffer += decoder.decode(value, { stream: true });

        for (const output of drainBufferedFrames()) {
          yield output;
        }

        if (receivedDoneSignal) {
          break;
        }
      }

      if (!receivedDoneSignal) {
        streamBuffer += decoder.decode();

        for (const output of drainBufferedFrames()) {
          yield output;
        }

        if (!receivedDoneSignal) {
          for (const output of drainTrailingFrame()) {
            yield output;
          }
        }
      }

      if (!receivedDoneSignal) {
        if (opts?.signal?.aborted) {
          return;
        }
        const debugInfo = lastFrame
          ? `Last frame:\n${lastFrame}${streamBuffer ? `\n\nRemaining streamBuffer:\n${streamBuffer}` : ''}`
          : (streamBuffer ? `Remaining streamBuffer:\n${streamBuffer}` : null);
        throw new BackendError('Stream ended without done event', null, debugInfo);
      }

      return;
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || opts?.signal?.aborted)) {
        throw error;
      }

      const wrapWithDebugInfo = (err: unknown): Error => {
        if (err instanceof BackendError) {
          return err;
        }

        const debugInfo = lastFrame
          ? `Last frame:\n${lastFrame}${streamBuffer ? `\n\nRemaining buffer:\n${streamBuffer}` : ''}`
          : (streamBuffer ? `Remaining buffer:\n${streamBuffer}` : null);
        const message = err instanceof Error ? err.message : String(err);
        return new BackendError(message, null, debugInfo);
      };

      if (hasYieldedEvent) {
        throw wrapWithDebugInfo(error);
      }

      let statusCode: number | null = null;
      if (error instanceof BackendError) {
        statusCode = error.statusCode;
      } else if (error instanceof Error) {
        const statusMatch = error.message.match(/\((\d+)\)/);
        statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      const isNetworkError = statusCode === null && (
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('NetworkError') ||
        errorMsg.includes('ECONNREFUSED') ||
        errorMsg.includes('ETIMEDOUT') ||
        errorMsg.toLowerCase().includes('network')
      );
      const isRetryableStatus = statusCode !== null &&
        Boolean(retryConfig?.retryableStatusCodes?.includes(statusCode));
      const isRetryable = Boolean(retryConfig?.enabled) && (isNetworkError || isRetryableStatus);

      if (isRetryable && attempt < maxAttempts - 1) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.log(
          `[Retry] Attempt ${attempt + 1}/${maxAttempts} failed: ${errorMsg} (status: ${statusCode}), retrying in ${retryConfig!.retryDelayMs}ms...`,
        );
        await sleep(retryConfig!.retryDelayMs);
        continue;
      }

      throw wrapWithDebugInfo(error);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export async function fetchModels(
  provider: ProviderType,
  config: ProviderConfig,
  request_format?: RequestFormat,
): Promise<any> {
  const endpoint = `${API_BASE}/providers/${provider}/models`;

  const provider_config = {
    api_key: config.apiKey,
    base_url: config.baseUrl,
    additional_headers: config.additionalHeaders,
    additional_body: config.additionalBody,
  };
  const requestBody: Record<string, unknown> = { provider_config };
  if (provider === 'custom') {
    requestBody.request_format = request_format ?? 'openai_sdk';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch models: ${errorText}`);
  }

  return response.json();
}

export async function fetchEmbeddingModels(
  provider: ProviderType,
  config: ProviderConfig,
): Promise<any> {
  const endpoint = `${API_BASE}/providers/${provider}/embedding-models`;

  const backendConfig = {
    api_key: config.apiKey,
    base_url: config.baseUrl,
    additional_headers: config.additionalHeaders,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(backendConfig),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch embedding models: ${errorText}`);
  }

  return response.json();
}

export async function fetchProviders(): Promise<any> {
  const endpoint = `${API_BASE}/providers`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch providers: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchModelEndpoints(
  canonicalSlug: string,
  apiKey?: string,
): Promise<any> {
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured');
  }

  const endpoint = `https://openrouter.ai/api/v1/models/${canonicalSlug}/endpoints`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch model endpoints: ${response.statusText}`);
  }

  return response.json();
}
