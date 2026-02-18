import { API_BASE_URL, apiClient } from './client';
import type { RunStatus, ToolCallStatus } from '../types/thread';

interface RuntimeEventBase {
  project_id: string;
  thread_id: string;
  run_id: string | null;
  ts: string;
  thread_type?: string;
}

export type ThreadSSEEvent =
  | { event: 'run:status'; data: RuntimeEventBase & { status: RunStatus; error?: string | null } }
  | { event: 'message:user'; data: RuntimeEventBase & { message_id: string; role: 'user'; seq: number; seq_in_thread: number; data: Record<string, unknown> } }
  | { event: 'message:start'; data: RuntimeEventBase & { message_id: string; role: 'assistant'; seq: number; seq_in_thread: number } }
  | { event: 'content:delta'; data: RuntimeEventBase & { message_id: string; text: string } }
  | { event: 'thinking:delta'; data: RuntimeEventBase & { message_id: string; text: string } }
  | { event: 'tool_call:start'; data: RuntimeEventBase & { tool_call_id: string; message_id: string; assistant_message_id: string; index: number; name: string } }
  | { event: 'tool_call:delta'; data: RuntimeEventBase & { tool_call_id: string; index: number; arguments_delta: string; name?: string } }
  | { event: 'tool_call:end'; data: RuntimeEventBase & { tool_call_id: string; message_id: string; assistant_message_id: string; index: number; name: string; arguments: Record<string, unknown>; status?: ToolCallStatus } }
  | { event: 'tool_call:status'; data: RuntimeEventBase & { tool_call_id: string; status: ToolCallStatus; reason?: string | null; result?: Record<string, unknown> | null } }
  | { event: 'message:end'; data: RuntimeEventBase & { message_id: string; seq_in_thread: number; data: Record<string, unknown> } }
  | { event: 'run:done'; data: RuntimeEventBase & { final_status: RunStatus } }
  | { event: 'run:error'; data: RuntimeEventBase & { error: string } }
  | { event: 'run:canceled'; data: RuntimeEventBase }
  | { event: 'llm:request'; data: RuntimeEventBase & {
      message_id: string;
      provider: string;
      model: string;
      temperature: number;
      max_tokens: number | null;
      tool_choice: string | null;
      thinking_config: Record<string, unknown> | null;
      thinking_mode: string;
      native_tool_call: boolean;
      messages: Array<{ role: string; content_parts: Array<{ type: string; text: string }> }>;
      tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> | null;
    }}
  | { event: string; data: Record<string, unknown> };

interface ConnectOptions {
  onReconnect?: () => Promise<void> | void;
}

function parseSseFrame(frame: string): ThreadSSEEvent | null {
  const lines = frame
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith(':'));

  if (lines.length === 0) return null;

  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
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
    return { event: eventName, data: parsed } as ThreadSSEEvent;
  } catch (error) {
    console.warn('Discarding malformed SSE payload', { eventName, payload, error });
    return null;
  }
}

function reconnectDelayMs(attempt: number): number {
  const capped = Math.min(attempt, 6);
  return 300 * (2 ** capped);
}

async function openAndReadStream(
  url: string,
  signal: AbortSignal,
  onEvent: (event: ThreadSSEEvent) => void,
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

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) break;
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseFrame(frame);
      if (event) onEvent(event);
    }
  }
}

export async function connectProjectStream(
  projectId: string,
  onEvent: (event: ThreadSSEEvent) => void,
  signal: AbortSignal,
  options?: ConnectOptions,
): Promise<void> {
  const streamUrl = `${API_BASE_URL}/api/v1/projects/${projectId}/stream`;
  let attempt = 0;

  while (!signal.aborted) {
    try {
      let receivedEvent = false;
      await openAndReadStream(streamUrl, signal, (event) => {
        receivedEvent = true;
        onEvent(event);
      });
      if (signal.aborted) return;
      if (receivedEvent) {
        attempt = 0;
      } else {
        attempt += 1;
      }
      const delay = reconnectDelayMs(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await options?.onReconnect?.();
    } catch (error) {
      if (signal.aborted) return;
      attempt += 1;
      const delay = reconnectDelayMs(attempt);
      console.warn('Project SSE disconnected. Reconnecting...', {
        projectId,
        attempt,
        delay,
        error,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      await options?.onReconnect?.();
    }
  }
}

export default connectProjectStream;

