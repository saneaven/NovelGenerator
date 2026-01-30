/**
 * Unified token counting service.
 *
 * Handles token counting for all providers:
 * - OpenAI/xAI: Uses tiktoken locally (no API call)
 * - Claude/Gemini: Uses backend API endpoints
 * - OpenRouter/Custom: Uses the specified tokenizer override
 */

import { getEncoding, type Tiktoken } from 'js-tiktoken';
import { tokenService } from '../api/tokenService';
import type { ProviderType } from '../store/settingsStore';
import { useCredentialsStore } from '../store/credentialsStore';

export type TokenizerType = 'openai' | 'claude' | 'gemini';

export interface TokenCountResult {
  tokenCount: number;
  provider: string;
  isEstimate: boolean;
  error?: string;
}

// Singleton encoder instances for performance
let cl100kEncoder: Tiktoken | null = null;
let o200kEncoder: Tiktoken | null = null;

/**
 * Get or create a tiktoken encoder for the given encoding.
 */
function getEncoder(encoding: 'cl100k_base' | 'o200k_base'): Tiktoken {
  if (encoding === 'o200k_base') {
    if (!o200kEncoder) {
      o200kEncoder = getEncoding('o200k_base');
    }
    return o200kEncoder;
  }
  if (!cl100kEncoder) {
    cl100kEncoder = getEncoding('cl100k_base');
  }
  return cl100kEncoder;
}

/**
 * Determine which tiktoken encoding to use based on model name.
 * GPT-4o and GPT-5 models use o200k_base, earlier models use cl100k_base.
 */
function getEncodingForModel(model: string): 'cl100k_base' | 'o200k_base' {
  const lowerModel = model.toLowerCase();
  // GPT-4o, GPT-5, and newer models use o200k_base
  if (lowerModel.includes('gpt-4o') || lowerModel.includes('gpt-5') || lowerModel.includes('o1') || lowerModel.includes('o3')) {
    return 'o200k_base';
  }
  // Default to cl100k_base for older models
  return 'cl100k_base';
}

/**
 * Count tokens locally using tiktoken.
 */
function countTokensLocal(text: string, model: string): number {
  const encoding = getEncodingForModel(model);
  const encoder = getEncoder(encoding);
  return encoder.encode(text).length;
}

/**
 * Determine which tokenizer to use based on provider and override settings.
 */
function resolveTokenizer(
  provider: ProviderType,
  tokenizerOverride?: TokenizerType
): TokenizerType {
  // If override is specified, use it
  if (tokenizerOverride) {
    return tokenizerOverride;
  }

  // Map provider to default tokenizer
  switch (provider) {
    case 'openai':
    case 'xai':
      return 'openai';
    case 'claude':
      return 'claude';
    case 'gemini':
      return 'gemini';
    case 'openrouter':
    case 'custom':
      // Default to OpenAI for openrouter/custom if no override
      return 'openai';
    default:
      return 'openai';
  }
}

/**
 * Count tokens for the given text.
 *
 * @param text - The text to count tokens for
 * @param provider - The LLM provider type
 * @param model - The model name
 * @param tokenizerOverride - Optional tokenizer override (for OpenRouter/Custom)
 * @param signal - Optional AbortSignal for cancellation
 */
export async function countTokens(
  text: string,
  provider: ProviderType,
  model: string,
  tokenizerOverride?: TokenizerType,
  signal?: AbortSignal
): Promise<TokenCountResult> {
  // Empty text = 0 tokens
  if (!text || text.trim().length === 0) {
    return {
      tokenCount: 0,
      provider: 'none',
      isEstimate: true,
    };
  }

  const effectiveTokenizer = resolveTokenizer(provider, tokenizerOverride);

  // Local counting with tiktoken (OpenAI-compatible)
  if (effectiveTokenizer === 'openai') {
    try {
      const count = countTokensLocal(text, model);
      return {
        tokenCount: count,
        provider: 'tiktoken',
        isEstimate: true,
      };
    } catch (error) {
      return {
        tokenCount: 0,
        provider: 'tiktoken',
        isEstimate: true,
        error: error instanceof Error ? error.message : 'Tokenization failed',
      };
    }
  }

  // Remote counting via API (Claude/Gemini)
  try {
    const creds = useCredentialsStore.getState().credentials as any;
    const config =
      effectiveTokenizer === 'claude'
        ? { api_key: creds?.claude?.apiKey || undefined }
        : effectiveTokenizer === 'gemini'
          ? { api_key: creds?.gemini?.apiKey || undefined }
          : {};

    // If we don't have a key, skip network call and fall back to estimate.
    if (!config.api_key) {
      const count = countTokensLocal(text, model);
      return {
        tokenCount: count,
        provider: 'tiktoken (fallback)',
        isEstimate: true,
        error: `Missing API key for '${effectiveTokenizer}' token counting (Settings > Credentials).`,
      };
    }

    const response = await tokenService.countTokens(
      {
        provider: effectiveTokenizer,
        model,
        text,
        config,
      },
      { signal }
    );
    return {
      tokenCount: response.token_count,
      provider: effectiveTokenizer,
      isEstimate: false,
    };
  } catch (error) {
    // If aborted, don't fallback
    if (signal?.aborted) {
      return {
        tokenCount: 0,
        provider: effectiveTokenizer,
        isEstimate: true,
        error: 'Request aborted',
      };
    }

    // Fallback to tiktoken on API error
    try {
      const count = countTokensLocal(text, model);
      return {
        tokenCount: count,
        provider: 'tiktoken (fallback)',
        isEstimate: true,
        error: error instanceof Error ? error.message : 'API call failed, using estimate',
      };
    } catch {
      return {
        tokenCount: 0,
        provider: 'unknown',
        isEstimate: true,
        error: 'All tokenization methods failed',
      };
    }
  }
}
