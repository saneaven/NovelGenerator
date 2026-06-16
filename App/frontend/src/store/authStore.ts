import { create } from 'zustand';
import { authService, type UserResponse, type ProfileUpdate } from '../api';
import { queryClient } from '../data/queryClient';

interface AuthStore {
  user: UserResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  register: (email: string, username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  updateProfile: (data: ProfileUpdate) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  register: async (email: string, username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      await authService.register({ email, username, password });
      // Token is automatically stored by authService
      // Now fetch the user data
      const user = await authService.getCurrentUser();
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      });
      throw error;
    }
  },

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      await authService.login({ username, password });
      // Token is automatically stored by authService
      // Now fetch the user data
      const user = await authService.getCurrentUser();
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      });
      throw error;
    }
  },

  logout: () => {
    authService.logout();
    // Drop ALL cached server data (settings, projects, objects, presets, ...)
    // so a subsequent login never sees the previous session's cache.
    queryClient.clear();
    set({
      user: null,
      isAuthenticated: false,
      error: null,
    });
  },

  checkAuth: async () => {
    // Only check if we have a token
    if (!authService.isAuthenticated()) {
      set({ isAuthenticated: false, user: null });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const user = await authService.getCurrentUser();
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      // Token is invalid
      authService.logout();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null, // Don't show error for invalid token
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  updateProfile: async (data: ProfileUpdate) => {
    set({ isLoading: true, error: null });
    try {
      const updatedUser = await authService.updateProfile(data);
      set({
        user: updatedUser,
        isLoading: false,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update profile',
      });
      throw error;
    }
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    set({ isLoading: true, error: null });
    try {
      await authService.changePassword({ current_password: currentPassword, new_password: newPassword });
      set({ isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to change password',
      });
      throw error;
    }
  },
}));
