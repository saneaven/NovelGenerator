import { apiClient } from './client';
import type { ProviderCredentials } from '../store/settingsStore';

export interface CredentialVaultStatusResponse {
  hasKeyByProvider: Record<string, boolean>;
  updatedAt: string | null;
  vaultConfigured: boolean;
}

export const credentialsService = {
  async getStatus(): Promise<CredentialVaultStatusResponse> {
    return await apiClient.get<CredentialVaultStatusResponse>('/api/v1/credentials/status');
  },

  async upsert(credentials: ProviderCredentials): Promise<CredentialVaultStatusResponse> {
    return await apiClient.put<CredentialVaultStatusResponse>('/api/v1/credentials', credentials);
  },

  async delete(): Promise<CredentialVaultStatusResponse> {
    return await apiClient.delete<CredentialVaultStatusResponse>('/api/v1/credentials');
  },
};

