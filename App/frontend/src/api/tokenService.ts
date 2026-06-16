/**
 * API service for token counting
 */
import { apiClient, type RequestOptions } from './client';
import type { ProviderType, TokenizerOverride } from '../domain/settings';

const BASE_PATH = '/api/v1/tokens';

export interface CountTokensRequest {
  provider: ProviderType;
  model: string;
  text: string;
  tokenizer_override?: TokenizerOverride;
  variant_hint?: string | null;
}

export interface CountTokensResponse {
  token_count: number;
  provider: string;
  model: string;
  effective_tokenizer: 'openai' | 'claude' | 'gemini';
  is_estimate: boolean;
  fallback_used: boolean;
  method: 'tiktoken' | 'claude_api' | 'gemini_api';
}

export const tokenService = {
  /**
   * Count tokens with backend runtime policy (tokenizer override + fallback).
   */
  async countTokens(
    request: CountTokensRequest,
    options?: RequestOptions
  ): Promise<CountTokensResponse> {
    return await apiClient.post<CountTokensResponse>(
      `${BASE_PATH}/count`,
      request,
      undefined,
      options
    );
  },
};
