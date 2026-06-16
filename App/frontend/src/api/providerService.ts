/**
 * Provider API service — model listing and provider endpoints.
 * Extracted from the deleted llm/llmService.ts.
 */

import { apiClient, API_BASE_URL } from './client';
import type { ProviderType, CustomKind } from '../domain/settings';
import type { PublicProviderSpecResponse } from '../providerEngine/types';

const API_BASE = `${API_BASE_URL}/api/v1`;

function getAuthHeaders(): HeadersInit {
  const token = apiClient.getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchModels(
  provider: ProviderType,
  custom_kind?: CustomKind,
): Promise<any> {
  const endpoint = `${API_BASE}/providers/${provider}/models`;
  const requestBody: Record<string, unknown> = {};
  if (custom_kind) {
    requestBody.custom_kind = custom_kind;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch models: ${errorText}`);
  }

  return response.json();
}

export async function fetchEmbeddingModels(
  provider: ProviderType,
): Promise<any> {
  const endpoint = `${API_BASE}/providers/${provider}/embedding-models`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch embedding models: ${errorText}`);
  }

  return response.json();
}

export async function fetchProviderSpecs(): Promise<PublicProviderSpecResponse> {
  return apiClient.get<PublicProviderSpecResponse>('/api/v1/provider-specs');
}

export async function fetchModelEndpoints(
  canonicalSlug: string,
): Promise<any> {
  const endpoint = `${API_BASE}/providers/openrouter/models/${encodeURIComponent(canonicalSlug)}/endpoints`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch model endpoints: ${response.statusText}`);
  }

  return response.json();
}
