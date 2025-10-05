import { type ConversationBlock } from "./types";
import { type ProviderType, type ProviderConfig, type ProviderPreference } from "../store/settingsStore";

const API_BASE = "http://localhost:8000/api/v1";

/**
 * Stream chat completions from any provider
 */
export async function* streamChat(
  messages: ConversationBlock[],
  provider: ProviderType,
  providerConfig: ProviderConfig,
  opts?: {
    signal?: AbortSignal;
    temperature?: number;
    model?: string;
    functions?: any[];
    providerPreference?: ProviderPreference;
  }
): AsyncGenerator<string | { content: string | null; tool_calls?: any[] }> {
  const endpoint = `${API_BASE}/chat/completions/${provider}/stream`;

  // Build request body
  const requestBody: any = {
    messages,
    model: opts?.model || 'gpt-4',
    temperature: opts?.temperature ?? 0.7,
    config: providerConfig
  };

  if (opts?.functions) {
    requestBody.functions = opts.functions;
  }

  // Add provider preference for OpenRouter
  if (provider === 'openrouter' && opts?.providerPreference) {
    requestBody.provider_preference = opts.providerPreference;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: opts?.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const errorMessage = text ? text : `HTTP ${res.status} ${res.statusText}`;
    throw new Error(`Backend Error (${res.status}): ${errorMessage}`);
  }

  // SSE frame parser
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE uses empty line (\n\n) to separate frames
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      // Ignore comment/ping frames
      if (!frame || frame.startsWith(":")) continue;

      // Handle error events
      if (frame.startsWith("event: error")) {
        const dataMatch = frame.match(/data:\s*(.+)/);
        if (dataMatch) {
          try {
            const errorData = JSON.parse(dataMatch[1]);
            throw new Error(`Backend Error: ${errorData.message || 'Unknown error'}`);
          } catch (parseError) {
            throw new Error(`Backend Error: ${dataMatch[1]}`);
          }
        }
        throw new Error('Backend Error: Unknown error occurred');
      }

      // Extract data: lines
      const dataLines = frame
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());

      for (const data of dataLines) {
        if (!data) continue;
        if (data === "[DONE]") return;

        // OpenAI-compatible stream: handle content and tool_calls
        try {
          const chunk = JSON.parse(data);

          const delta = chunk?.choices?.[0]?.delta;
          const content: string | undefined = delta?.content;
          const tool_calls = delta?.tool_calls;

          // Yield tool calls as object
          if (tool_calls && tool_calls.length > 0) {
            yield {
              content: content || null,
              tool_calls: tool_calls
            };
          } else if (content) {
            yield content;
          }

          const finish = chunk?.choices?.[0]?.finish_reason;
          if (finish && finish !== null) return;
        } catch (error) {
          // If not JSON, yield as-is
          yield data;
        }
      }
    }
  }
}

/**
 * Fetch available models for a provider
 */
export async function fetchModels(
  provider: ProviderType,
  config: ProviderConfig
): Promise<any> {
  const endpoint = `${API_BASE}/providers/${provider}/models`;

  // Convert camelCase to snake_case for backend
  const backendConfig = {
    api_key: config.apiKey,
    base_url: config.baseUrl,
    additional_headers: config.additionalHeaders
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(backendConfig)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch models: ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch list of available providers
 */
export async function fetchProviders(): Promise<any> {
  const endpoint = `${API_BASE}/providers`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch providers: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch provider endpoints for a specific OpenRouter model
 */
export async function fetchModelEndpoints(
  canonicalSlug: string,
  apiKey: string
): Promise<any> {
  const endpoint = `https://openrouter.ai/api/v1/models/${canonicalSlug}/endpoints`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch model endpoints: ${response.statusText}`);
  }

  return response.json();
}
