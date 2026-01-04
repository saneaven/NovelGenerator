import { create } from 'zustand';

/**
 * SidebarStore - Unified Sidebar State Management
 *
 * This store handles all sidebar visibility state with:
 * - Exclusive opening: Only one sidebar can be open at a time per project
 * - Per-project state: Each project maintains its own sidebar state
 *
 * Usage:
 *   const { isOpen, toggleSidebar } = useSidebarStore();
 *   toggleSidebar(projectId, 'agent');  // Opens agent, closes any other sidebar
 */

export type SidebarId = 'agent' | 'chapter' | string;

interface SidebarState {
  // Per-project open sidebar tracking (only one at a time per project)
  openSidebarByProject: Record<string, SidebarId | null>;
}

interface SidebarActions {
  // Core operations
  openSidebar: (projectId: string, sidebarId: SidebarId) => void;
  closeSidebar: (projectId: string) => void;
  toggleSidebar: (projectId: string, sidebarId: SidebarId) => void;

  // Query methods
  isOpen: (projectId: string, sidebarId: SidebarId) => boolean;
  getOpenSidebar: (projectId: string) => SidebarId | null;

  // Cleanup
  resetProjectState: (projectId: string) => void;
}

type SidebarStore = SidebarState & SidebarActions;

const initialState: SidebarState = {
  openSidebarByProject: {},
};

export const useSidebarStore = create<SidebarStore>()((set, get) => ({
  ...initialState,

  // Opens a sidebar, automatically closing any other open sidebar for this project
  openSidebar: (projectId: string, sidebarId: SidebarId) => {
    set((state) => ({
      openSidebarByProject: {
        ...state.openSidebarByProject,
        [projectId]: sidebarId,
      },
    }));
  },

  // Closes the currently open sidebar for this project
  closeSidebar: (projectId: string) => {
    set((state) => ({
      openSidebarByProject: {
        ...state.openSidebarByProject,
        [projectId]: null,
      },
    }));
  },

  // Toggles a sidebar - opens if closed, closes if already open
  toggleSidebar: (projectId: string, sidebarId: SidebarId) => {
    const currentOpen = get().openSidebarByProject[projectId];
    if (currentOpen === sidebarId) {
      get().closeSidebar(projectId);
    } else {
      get().openSidebar(projectId, sidebarId);
    }
  },

  // Check if a specific sidebar is open
  isOpen: (projectId: string, sidebarId: SidebarId) => {
    return get().openSidebarByProject[projectId] === sidebarId;
  },

  // Get the currently open sidebar ID for a project
  getOpenSidebar: (projectId: string) => {
    return get().openSidebarByProject[projectId] ?? null;
  },

  // Reset state when leaving a project
  resetProjectState: (projectId: string) => {
    set((state) => {
      const { [projectId]: _, ...rest } = state.openSidebarByProject;
      return { openSidebarByProject: rest };
    });
  },
}));
