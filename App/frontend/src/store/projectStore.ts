import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;
  
  // Actions
  createProject: (name: string, description: string) => Project;
  deleteProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Omit<Project, 'id'>>) => void;
  setCurrentProject: (id: string | null) => void;
  getCurrentProject: () => Project | null;
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProjectId: null,

      createProject: (name: string, description: string) => {
        const newProject: Project = {
          id: crypto.randomUUID(),
          name,
          description,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set((state) => ({
          projects: [...state.projects, newProject],
        }));

        return newProject;
      },

      deleteProject: (id: string) => {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
        }));
      },

      updateProject: (id: string, updates: Partial<Omit<Project, 'id'>>) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? { ...p, ...updates, updatedAt: new Date() }
              : p
          ),
        }));
      },

      setCurrentProject: (id: string | null) => {
        set({ currentProjectId: id });
      },

      getCurrentProject: () => {
        const state = get();
        return state.projects.find((p) => p.id === state.currentProjectId) || null;
      },
    }),
    {
      name: 'project-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            const parsed = JSON.parse(str);
            // Convert date strings back to Date objects
            if (parsed.state?.projects) {
              parsed.state.projects = parsed.state.projects.map((project: any) => ({
                ...project,
                createdAt: new Date(project.createdAt),
                updatedAt: new Date(project.updatedAt),
              }));
            }
            return parsed;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);