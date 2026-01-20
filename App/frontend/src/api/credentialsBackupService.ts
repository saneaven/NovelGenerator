import { apiClient } from './client';

export interface CredentialBackupStatusResponse {
  hasBackup: boolean;
  updatedAt: string | null;
}

export interface CredentialBackupBlobResponse {
  blob: string;
  updatedAt: string;
}

export const credentialsBackupService = {
  async getStatus(): Promise<CredentialBackupStatusResponse> {
    return await apiClient.get<CredentialBackupStatusResponse>('/api/v1/credentials-backup/status');
  },

  async upload(password: string, blob: string): Promise<CredentialBackupStatusResponse> {
    return await apiClient.put<CredentialBackupStatusResponse>('/api/v1/credentials-backup/blob', {
      password,
      blob,
    });
  },

  async download(password: string): Promise<CredentialBackupBlobResponse> {
    return await apiClient.post<CredentialBackupBlobResponse>('/api/v1/credentials-backup/blob', { password });
  },

  async delete(password: string): Promise<CredentialBackupStatusResponse> {
    return await apiClient.post<CredentialBackupStatusResponse>('/api/v1/credentials-backup/delete', { password });
  },
};

