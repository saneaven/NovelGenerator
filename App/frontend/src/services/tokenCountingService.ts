/**
 * Token counting service backed by the backend single counting path.
 */

import { tokenService } from '../api/tokenService';
import type { ProviderType, TokenizerOverride } from '../domain/settings';

export type TokenizerType = TokenizerOverride;

export interface TokenCountResult {
  tokenCount: number;
  provider: string;
  isEstimate: boolean;
  fallbackUsed: boolean;
  method: 'tiktoken' | 'claude_api' | 'gemini_api';
  effectiveTokenizer: 'openai' | 'claude' | 'gemini';
}

/**
 * Count tokens using backend runtime policy.
 *
 * - Same resolver/fallback policy as run pipeline.
 * - No frontend local tokenization path.
 */
export async function countTokens(
  text: string,
  provider: ProviderType,
  model: string,
  tokenizer_override?: TokenizerType,
  variant_hint?: string | null,
  signal?: AbortSignal
): Promise<TokenCountResult> {
  const response = await tokenService.countTokens(
    {
      provider,
      model,
      text,
      tokenizer_override,
      variant_hint,
    },
    { signal }
  );

  return {
    tokenCount: response.token_count,
    provider: response.provider,
    isEstimate: response.is_estimate,
    fallbackUsed: response.fallback_used,
    method: response.method,
    effectiveTokenizer: response.effective_tokenizer,
  };
}

export async function countObjectContentTokens(
  projectId: string,
  language: string,
  objectIds: string[],
  provider: ProviderType,
  model: string,
  tokenizer_override?: TokenizerType,
  variant_hint?: string | null,
  signal?: AbortSignal
): Promise<TokenCountResult> {
  const response = await tokenService.countObjectContentTokens(
    {
      project_id: projectId,
      language,
      object_ids: objectIds,
      provider,
      model,
      tokenizer_override,
      variant_hint,
    },
    { signal }
  );

  return {
    tokenCount: response.token_count,
    provider: response.provider,
    isEstimate: response.is_estimate,
    fallbackUsed: response.fallback_used,
    method: response.method,
    effectiveTokenizer: response.effective_tokenizer,
  };
}
