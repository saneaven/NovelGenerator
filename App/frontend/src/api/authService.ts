/**
 * Authentication service
 */

import apiClient from './client';
import type { UserCreate, UserLogin, AuthResponse, UserResponse } from './types';

export const authService = {
  /**
   * Register a new user
   */
  async register(data: UserCreate): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/api/v1/auth/register', data);
    // Store the token for automatic login after registration
    apiClient.setAuthToken(response.access_token);
    return response;
  },

  /**
   * Login user
   */
  async login(data: UserLogin): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/api/v1/auth/login', data);
    // Store the token
    apiClient.setAuthToken(response.access_token);
    return response;
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<UserResponse> {
    return apiClient.get<UserResponse>('/api/v1/auth/me');
  },

  /**
   * Logout user
   */
  logout() {
    apiClient.clearAuthToken();
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return apiClient.getAuthToken() !== null;
  },
};

export default authService;
