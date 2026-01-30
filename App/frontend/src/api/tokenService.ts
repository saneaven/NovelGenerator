/**
 * API service for token counting
 */
import { apiClient, type RequestOptions } from './client';

const BASE_PATH = '/api/v1/tokens';

export interface CountTokensRequest {
  provider: 'claude' | 'gemini';
  model: string;
  text: string;
  config?: {
    api_key?: string;
    base_url?: string;
    additional_headers?: Record<string, string>;
  };
}

export interface CountTokensResponse {
  token_count: number;
  provider: string;
  model: string;
}

export const tokenService = {
  /**
   * Count tokens for the given text using the specified provider's API.
   * Only supports 'claude' and 'gemini' providers (requires API call).
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
