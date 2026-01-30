/**
 * Account service (current user)
 */

import apiClient from './client';
import type { AccountStorageResponse } from './types';

export const accountService = {
  async getStorage(): Promise<AccountStorageResponse> {
    return apiClient.get<AccountStorageResponse>('/api/v1/account/storage');
  },
};

export default accountService;

