import apiClient from './client';
import type { AdminUserUpdateRequest, AdminUsersStorageResponse, AdminUserStorageItem } from './types';

export const adminService = {
  async listUsersStorage(): Promise<AdminUsersStorageResponse> {
    return apiClient.get<AdminUsersStorageResponse>('/api/v1/admin/users/storage');
  },

  async updateUser(userId: string, data: AdminUserUpdateRequest): Promise<AdminUserStorageItem> {
    return apiClient.patch<AdminUserStorageItem>(`/api/v1/admin/users/${userId}`, data);
  },
};

export default adminService;
