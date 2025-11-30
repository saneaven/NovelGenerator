import { type ConversationBlock, type ThinkingDetail } from "./types";
import { type ProviderType, type ProviderConfig, type ProviderPreference, type ThinkingConfig, type RetryConfig } from "../store/settingsStore";

const API_BASE = `http://${window.location.hostname}:8000/api/v1`;

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Custom error class that includes HTTP status code for retry decisions
 */
class BackendError extends Error {
    statusCode: number | null;

    constructor(message: string, statusCode: number | null = null) {
        super(message);
        this.name = 'BackendError';
        this.statusCode = statusCode;
    }
}

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
        thinkingConfig?: ThinkingConfig;
        thinkingMode?: 'off' | 'custom' | 'model';
        retryConfig?: RetryConfig;
    }
): AsyncGenerator<string | { content: string | null; tool_calls?: any[]; thinking?: string; thinking_details?: ThinkingDetail[]; thinking_text?: string; thinking_signature?: string }>
{
    const endpoint = `${API_BASE}/chat/completions/${provider}/stream`;

    // Build request body
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

    if (provider === 'openrouter' && opts?.providerPreference)
    {
        requestBody.provider_preference = opts.providerPreference;
    }

    if (opts?.thinkingConfig)
    {
        requestBody.thinking_config = opts.thinkingConfig;
    }

    if (opts?.thinkingMode)
    {
        requestBody.thinking_mode = opts.thinkingMode;
    }

    // Retry configuration
    const retryConfig = opts?.retryConfig;
    const maxAttempts = (retryConfig?.enabled && retryConfig?.maxRetries !== undefined)
        ? retryConfig.maxRetries + 1
        : 1;

    let lastError: Error | null = null;

    // Retry loop - wraps ENTIRE request including SSE processing
    for (let attempt = 0; attempt < maxAttempts; attempt++)
    {
        // Don't retry if aborted
        if (opts?.signal?.aborted)
        {
            throw new Error("Request aborted");
        }

        let hasYieldedContent = false;
        let res: Response | null = null;

        try
        {
            // 1. Make fetch request
            res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
                signal: opts?.signal,
            });

            // 2. Handle HTTP-level errors
            if (!res.ok || !res.body)
            {
                const statusCode = res.status;
                const text = await res.text().catch(() => "");
                const errorMessage = text ? text : `HTTP ${res.status} ${res.statusText}`;
                throw new BackendError(`Backend Error (${statusCode}): ${errorMessage}`, statusCode);
            }

            // 3. SSE stream processing (INSIDE retry loop)
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let receivedProperTermination = false;

            while (true)
            {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                let sep: number;
                while ((sep = buffer.indexOf("\n\n")) !== -1)
                {
                    const frame = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + 2);

                    if (!frame || frame.startsWith(":")) continue;

                    // Handle SSE error events - extract status code!
                    if (frame.startsWith("event: error"))
                    {
                        const dataMatch = frame.match(/data:\s*(.+)/);
                        if (dataMatch)
                        {
                            try
                            {
                                const errorData = JSON.parse(dataMatch[1]);
                                const statusCode = errorData.status || null;
                                throw new BackendError(
                                    `Backend Error: ${errorData.message || 'Unknown error'}`,
                                    statusCode
                                );
                            } catch (parseError)
                            {
                                if (parseError instanceof BackendError) throw parseError;
                                throw new BackendError(`Backend Error: ${dataMatch[1]}`, null);
                            }
                        }
                        throw new BackendError('Backend Error: Unknown error occurred', null);
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
                        if (data === "[DONE]") {
                            receivedProperTermination = true;
                            return;
                        }

                        try
                        {
                            const chunk = JSON.parse(data);

                            // Handle error objects in data frames
                            if (chunk?.error) {
                                const errMsg = chunk.error.message || chunk.error.code || JSON.stringify(chunk.error);
                                const statusCode = chunk.error.status || chunk.error.code || null;
                                throw new BackendError(`Backend Error: ${errMsg}`, typeof statusCode === 'number' ? statusCode : null);
                            }

                            const delta = chunk?.choices?.[0]?.delta;
                            const content: string | undefined = delta?.content;
                            const tool_calls = delta?.tool_calls;
                            const thinking_details: ThinkingDetail[] | undefined = delta?.thinking_details;
                            const thinking_text: string | undefined = delta?.thinking?.text;
                            const thinking_signature: string | undefined = delta?.thinking?.signature;

                            if (tool_calls || thinking_details || thinking_text || thinking_signature)
                            {
                                hasYieldedContent = true;
                                yield {
                                    content: null,
                                    tool_calls,
                                    thinking_details,
                                    thinking_text,
                                    thinking_signature,
                                };
                            } else if (content)
                            {
                                hasYieldedContent = true;
                                yield content;
                            }

                            const finish = chunk?.choices?.[0]?.finish_reason;
                            if (finish && finish !== null) {
                                receivedProperTermination = true;
                                return;
                            }
                        } catch (error)
                        {
                            if (error instanceof BackendError) throw error;
                            // If not JSON, yield as-is
                            hasYieldedContent = true;
                            yield data;
                        }
                    }
                }
            }

            // Check if stream ended properly
            if (!receivedProperTermination) {
                if (opts?.signal?.aborted) {
                    return;
                }
                throw new BackendError('Stream ended unexpectedly without completion signal', null);
            }

            // Success - exit retry loop
            return;

        }
        catch (error)
        {
            // Don't retry abort errors
            if (error instanceof Error && (error.name === "AbortError" || opts?.signal?.aborted))
            {
                throw error;
            }

            // Can't retry if we already yielded content (would duplicate)
            if (hasYieldedContent)
            {
                throw error;
            }

            // Extract status code for retry decision
            let statusCode: number | null = null;
            if (error instanceof BackendError)
            {
                statusCode = error.statusCode;
            }
            else if (error instanceof Error)
            {
                const statusMatch = error.message.match(/\((\d+)\)/);
                statusCode = statusMatch ? parseInt(statusMatch[1]) : null;
            }

            // Check if retryable
            const isNetworkError = statusCode === null;
            const isRetryableStatus = statusCode !== null &&
                retryConfig?.retryableStatusCodes?.includes(statusCode);
            const isRetryable = retryConfig?.enabled &&
                (isNetworkError || isRetryableStatus);

            if (isRetryable && attempt < maxAttempts - 1)
            {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.log(`[Retry] Attempt ${attempt + 1}/${maxAttempts} failed with status ${statusCode}, retrying in ${retryConfig!.retryDelayMs}ms...`);
                await sleep(retryConfig!.retryDelayMs);
                continue;
            }

            throw error;
        }
    }

    // If we exhausted all retries
    if (lastError)
    {
        throw lastError;
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

    const backendConfig = {
        api_key: config.apiKey,
        base_url: config.baseUrl,
        additional_headers: config.additionalHeaders
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" }
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
