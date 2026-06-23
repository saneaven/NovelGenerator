/**
 * React hook for token counting selected project object content.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { countObjectContentTokens, type TokenCountResult, type TokenizerType } from '../services/tokenCountingService';
import type { ProviderType } from '../domain/settings';

export interface UseObjectContentTokenCountOptions {
  projectId: string;
  language: string;
  objectIds: string[];
  provider: ProviderType;
  model: string;
  tokenizer_override?: TokenizerType;
  variant_hint?: string | null;
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseObjectContentTokenCountResult {
  tokenCount: number | null;
  isLoading: boolean;
  error: string | null;
  isEstimate: boolean;
  fallbackUsed: boolean;
}

const cache = new Map<string, TokenCountResult>();
const MAX_CACHE_SIZE = 100;

function getCacheKey(
  projectId: string,
  language: string,
  objectIds: string[],
  provider: string,
  model: string,
  tokenizer?: string,
  variantHint?: string | null
): string {
  return [
    projectId,
    language,
    objectIds.join(','),
    provider,
    model,
    tokenizer || 'default',
    variantHint || 'default',
  ].join(':');
}

export function useObjectContentTokenCount(options: UseObjectContentTokenCountOptions): UseObjectContentTokenCountResult {
  const {
    projectId,
    language,
    objectIds,
    provider,
    model,
    tokenizer_override,
    variant_hint,
    debounceMs = 500,
    enabled = true,
  } = options;

  const [result, setResult] = useState<UseObjectContentTokenCountResult>({
    tokenCount: null,
    isLoading: false,
    error: null,
    isEstimate: true,
    fallbackUsed: false,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectIdsKey = objectIds.join(',');

  const cacheKey = useMemo(
    () => getCacheKey(projectId, language, objectIds, provider, model, tokenizer_override, variant_hint),
    [projectId, language, objectIdsKey, provider, model, tokenizer_override, variant_hint]
  );

  useEffect(() => {
    if (!enabled || !projectId || !language || objectIds.length === 0 || !model) {
      setResult({
        tokenCount: null,
        isLoading: false,
        error: null,
        isEstimate: true,
        fallbackUsed: false,
      });
      return;
    }

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

    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setResult(prev => ({ ...prev, isLoading: true }));

    debounceRef.current = setTimeout(async () => {
      abortRef.current = new AbortController();

      try {
        const countResult = await countObjectContentTokens(
          projectId,
          language,
          objectIds,
          provider,
          model,
          tokenizer_override,
          variant_hint,
          abortRef.current.signal
        );

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

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [
    projectId,
    language,
    objectIdsKey,
    provider,
    model,
    tokenizer_override,
    variant_hint,
    debounceMs,
    enabled,
    cacheKey,
  ]);

  return result;
}

export default useObjectContentTokenCount;
