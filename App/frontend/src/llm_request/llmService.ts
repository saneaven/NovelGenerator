import { type ConversationBlock, type ReasoningDetail } from "./types";
import { type ProviderType, type ProviderConfig, type ProviderPreference, type ReasoningConfig } from "../store/settingsStore";

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
        reasoningConfig?: ReasoningConfig;
        thinkingMode?: 'off' | 'custom' | 'model';
    }
): AsyncGenerator<string | { content: string | null; tool_calls?: any[]; reasoning?: string; reasoning_details?: ReasoningDetail[]; reasoning_text?: string }>
{
    const endpoint = `${API_BASE}/chat/completions/${provider}/stream`;

    // Build request body
    // Convert camelCase to snake_case for backend
    const backendConfig = {
        api_key: providerConfig.apiKey,
        base_url: providerConfig.baseUrl,
        additional_headers: providerConfig.additionalHeaders
    };

    const requestBody: any = {
        messages,
        model: opts?.model || 'gpt-5',
        temperature: opts?.temperature ?? 0.7,
        config: backendConfig
    };

    if (opts?.functions)
    {
        requestBody.functions = opts.functions;
    }

    // Add provider preference for OpenRouter
    if (provider === 'openrouter' && opts?.providerPreference)
    {
        requestBody.provider_preference = opts.providerPreference;
    }

    // Add reasoning config for OpenRouter
    if (provider === 'openrouter' && opts?.reasoningConfig)
    {
        requestBody.reasoning_config = opts.reasoningConfig;
    }

    // Add thinking_mode for all providers
    if (opts?.thinkingMode)
    {
        requestBody.thinking_mode = opts.thinkingMode;
    }

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: opts?.signal,
    });

    if (!res.ok || !res.body)
    {
        const text = await res.text().catch(() => "");
        const errorMessage = text ? text : `HTTP ${res.status} ${res.statusText}`;
        throw new Error(`Backend Error (${res.status}): ${errorMessage}`);
    }

    // SSE frame parser
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true)
    {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE uses empty line (\n\n) to separate frames
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1)
        {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            // Ignore comment/ping frames
            if (!frame || frame.startsWith(":")) continue;

            // Handle error events
            if (frame.startsWith("event: error"))
            {
                const dataMatch = frame.match(/data:\s*(.+)/);
                if (dataMatch)
                {
                    try
                    {
                        const errorData = JSON.parse(dataMatch[1]);
                        throw new Error(`Backend Error: ${errorData.message || 'Unknown error'}`);
                    } catch (parseError)
                    {
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

            for (const data of dataLines)
            {
                if (!data) continue;
                if (data === "[DONE]") return;

                // OpenAI-compatible stream: handle content, tool_calls, and reasoning
                try
                {
                    const chunk = JSON.parse(data);

                    const delta = chunk?.choices?.[0]?.delta;
                    const content: string | undefined = delta?.content;
                    const tool_calls = delta?.tool_calls;
                    const reasoning_details = delta?.reasoning_details;
                    const reasoning_text: string | undefined = delta?.reasoning?.text;

                    // Yield tool calls or reasoning as object
                    if (tool_calls || reasoning_details || reasoning_text)
                    {
                        yield {
                            content: null,  // Don't send content with reasoning to prevent interruption
                            tool_calls,
                            reasoning_details,
                            reasoning_text
                        };
                    } else if (content)
                    {
                        yield content;
                    }

                    const finish = chunk?.choices?.[0]?.finish_reason;
                    if (finish && finish !== null) return;
                } catch (error)
                {
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
): Promise<any>
{
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

    if (!response.ok)
    {
        const errorText = await response.text();
        throw new Error(`Failed to fetch models: ${errorText}`);
    }

    return response.json();
}

/**
 * Fetch list of available providers
 */
export async function fetchProviders(): Promise<any>
{
    const endpoint = `${API_BASE}/providers`;

    const response = await fetch(endpoint, {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    });

    if (!response.ok)
    {
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
): Promise<any>
{
    const endpoint = `https://openrouter.ai/api/v1/models/${canonicalSlug}/endpoints`;

    const response = await fetch(endpoint, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        }
    });

    if (!response.ok)
    {
        throw new Error(`Failed to fetch model endpoints: ${response.statusText}`);
    }

    return response.json();
}
