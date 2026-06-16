/**
 * React hook for token counting with debouncing and caching.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { countTokens, type TokenizerType, type TokenCountResult } from '../services/tokenCountingService';
import type { ProviderType } from '../domain/settings';

export interface UseTokenCountOptions {
  /** The text to count tokens for */
  text: string;
  /** The LLM provider type */
  provider: ProviderType;
  /** The model name */
  model: string;
  /** Optional tokenizer override (for OpenRouter/Custom) */
  tokenizer_override?: TokenizerType;
  /** Optional provider variant hint (for Custom provider runtime variants) */
  variant_hint?: string | null;
  /** Debounce delay in milliseconds (default: 500) */
  debounceMs?: number;
  /** Whether token counting is enabled (default: true) */
  enabled?: boolean;
}

export interface UseTokenCountResult {
  /** The token count (null if not yet counted) */
  tokenCount: number | null;
  /** Whether token counting is in progress */
  isLoading: boolean;
  /** Error message if counting failed */
  error: string | null;
  /** Whether the count is an estimate (tiktoken) vs exact (API) */
  isEstimate: boolean;
  /** Whether fallback path was used */
  fallbackUsed: boolean;
}

// Simple LRU cache for token counts
const cache = new Map<string, TokenCountResult>();
const MAX_CACHE_SIZE = 100;

/**
 * Generate a cache key for the given parameters.
 * Uses text prefix + length to avoid storing huge strings.
 */
function getCacheKey(
  text: string,
  provider: string,
  model: string,
  tokenizer?: string,
  variantHint?: string | null
): string {
  const textHash = `${text.substring(0, 100)}:${text.length}`;
  return `${provider}:${model}:${tokenizer || 'default'}:${variantHint || 'default'}:${textHash}`;
}

/**
 * Hook for counting tokens with debouncing and caching.
 */
export function useTokenCount(options: UseTokenCountOptions): UseTokenCountResult {
  const {
    text,
    provider,
    model,
    tokenizer_override,
    variant_hint,
    debounceMs = 500,
    enabled = true,
  } = options;

  const [result, setResult] = useState<UseTokenCountResult>({
    tokenCount: null,
    isLoading: false,
    error: null,
    isEstimate: true,
    fallbackUsed: false,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Generate cache key
  const cacheKey = useMemo(
    () => getCacheKey(text, provider, model, tokenizer_override, variant_hint),
    [text, provider, model, tokenizer_override, variant_hint]
  );

  useEffect(() => {
    // Skip if disabled or missing required params
    if (!enabled || !text || !model) {
      setResult({
        tokenCount: null,
        isLoading: false,
        error: null,
        isEstimate: true,
        fallbackUsed: false,
      });
      return;
    }

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      setResult({
        tokenCount: cached.tokenCount,
        isLoading: false,
        error: null,
        isEstimate: cached.isEstimate,
        fallbackUsed: cached.fallbackUsed,
      });
      return;
    }

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Set loading state
    setResult(prev => ({ ...prev, isLoading: true }));

    // Debounced token counting
    debounceRef.current = setTimeout(async () => {
      abortRef.current = new AbortController();

      try {
        const countResult = await countTokens(
          text,
          provider,
          model,
          tokenizer_override,
          variant_hint,
          abortRef.current.signal
        );

        // Update cache (LRU eviction)
        if (cache.size >= MAX_CACHE_SIZE) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        cache.set(cacheKey, countResult);

        setResult({
          tokenCount: countResult.tokenCount,
          isLoading: false,
          error: null,
          isEstimate: countResult.isEstimate,
          fallbackUsed: countResult.fallbackUsed,
        });
      } catch (error) {
        // Don't update state if aborted
        if (abortRef.current?.signal.aborted) {
          return;
        }

        setResult({
          tokenCount: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Token counting failed',
          isEstimate: true,
          fallbackUsed: false,
        });
      }
    }, debounceMs);

    // Cleanup
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [text, provider, model, tokenizer_override, variant_hint, debounceMs, enabled, cacheKey]);

  return result;
}

export default useTokenCount;
