import { create } from 'zustand';
import { projectService } from '../api';
import type { Asset } from '../api/assetService';

export interface Project {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  cover_asset?: Asset | null;  // From BasicInfo's cover image
}

interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchProjects: () => Promise<void>;
  createProject: (name: string, description: string, mainLanguage: string) => Promise<Project>;
  importProject: (file: File) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  updateProject: (id: string, updates: { name?: string; description?: string }) => Promise<void>;
  setCurrentProject: (id: string | null) => void;
  getCurrentProject: () => Project | null;
  clearError: () => void;
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await projectService.list();
      set({ projects: Array.isArray(projects) ? projects : [], isLoading: false });
    } catch (error) {
      set({
        projects: [],
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch projects',
      });
    }
  },

  createProject: async (name: string, description: string, mainLanguage: string) => {
    set({ isLoading: true, error: null });
    try {
      const newProject = await projectService.create({ name, description, main_language: mainLanguage });
      set((state) => ({
        projects: [...state.projects, newProject],
        isLoading: false,
      }));
      return newProject;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create project',
      });
      throw error;
    }
  },

  importProject: async (file: File) => {
    set({ isLoading: true, error: null });
    try {
      const importedProject = await projectService.importProject(file);
      set((state) => ({
        projects: [...state.projects, importedProject],
        isLoading: false,
      }));
      return importedProject;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to import project',
      });
      throw error;
    }
  },

  deleteProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await projectService.delete(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete project',
      });
      throw error;
    }
  },

  updateProject: async (id: string, updates: { name?: string; description?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const updatedProject = await projectService.update(id, updates);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updatedProject : p)),
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update project',
      });
      throw error;
    }
  },

  setCurrentProject: (id: string | null) => {
    set({ currentProjectId: id });
    // Store current project ID in localStorage for persistence
    if (id) {
      localStorage.setItem('currentProjectId', id);
    } else {
      localStorage.removeItem('currentProjectId');
    }
  },

  getCurrentProject: () => {
    const state = get();
    return state.projects.find((p) => p.id === state.currentProjectId) || null;
  },

  clearError: () => {
    set({ error: null });
  },
}));

// Initialize current project from localStorage
const storedProjectId = localStorage.getItem('currentProjectId');
if (storedProjectId) {
  useProjectStore.setState({ currentProjectId: storedProjectId });
}
