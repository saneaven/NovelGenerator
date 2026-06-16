import { create } from 'zustand';

/**
 * EditorStore - UI State for Novel Editor
 *
 * This store handles all UI state for the novel editor:
 * - Selected chapter per project
 * - Modal visibility states
 * - Editor content and saving state
 * - Display preferences
 *
 * All manuscript (content) data is managed by unifiedObjectStore.
 */

interface EditorUIState {
  // Outline selection per project
  selectedOutlineByProject: Record<string, string | undefined>;

  // Chapter selection per project
  selectedChapterByProject: Record<string, string | undefined>;

  // Modal states (global - one at a time)
  isAIEditModalOpen: boolean;
  isVersionModalOpen: boolean;
  isSettingsOpen: boolean;

  // Editor state per project
  editorContentByProject: Record<string, string>;
  isSavingByProject: Record<string, boolean>;
  hasUnsavedChangesByProject: Record<string, boolean>;

}

interface EditorActions {
  // Outline selection
  selectOutline: (projectId: string, outlineId: string) => void;
  getSelectedOutlineId: (projectId: string) => string | undefined;
  syncOutlineFromStorage: (projectId: string) => void;
  clearSelectedOutline: (projectId: string) => void;

  // Chapter selection
  selectChapter: (projectId: string, chapterId: string) => void;
  getSelectedChapterId: (projectId: string) => string | undefined;
  syncChapterFromStorage: (projectId: string) => void;
  clearSelectedChapter: (projectId: string) => void;

  // Modal states
  setAIEditModalOpen: (open: boolean) => void;
  setVersionModalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;

  // Editor state
  setEditorContent: (projectId: string, content: string) => void;
  getEditorContent: (projectId: string) => string;
  setIsSaving: (projectId: string, saving: boolean) => void;
  getIsSaving: (projectId: string) => boolean;
  setHasUnsavedChanges: (projectId: string, hasChanges: boolean) => void;
  getHasUnsavedChanges: (projectId: string) => boolean;

  // Reset project state
  resetProjectState: (projectId: string) => void;
}

type EditorStore = EditorUIState & EditorActions;

const initialState: EditorUIState = {
  selectedOutlineByProject: {},
  selectedChapterByProject: {},
  isAIEditModalOpen: false,
  isVersionModalOpen: false,
  isSettingsOpen: false,
  editorContentByProject: {},
  isSavingByProject: {},
  hasUnsavedChangesByProject: {},
};

export const useEditorStore = create<EditorStore>()((set, get) => ({
  ...initialState,

  // Outline selection
  selectOutline: (projectId: string, outlineId: string) => {
    set((state) => ({
      selectedOutlineByProject: {
        ...state.selectedOutlineByProject,
        [projectId]: outlineId,
      },
    }));
    localStorage.setItem(`selectedOutline_${projectId}`, outlineId);
  },

  getSelectedOutlineId: (projectId: string) => {
    // First check state
    const stateOutlineId = get().selectedOutlineByProject[projectId];
    if (stateOutlineId) return stateOutlineId;

    // Fall back to localStorage (read-only, no state update during render)
    const storedOutlineId = localStorage.getItem(`selectedOutline_${projectId}`);
    return storedOutlineId || undefined;
  },

  // Sync localStorage value to state (call this in useEffect, not during render)
  syncOutlineFromStorage: (projectId: string) => {
    const stateOutlineId = get().selectedOutlineByProject[projectId];
    if (stateOutlineId) return; // Already in state

    const storedOutlineId = localStorage.getItem(`selectedOutline_${projectId}`);
    if (storedOutlineId) {
      set((state) => ({
        selectedOutlineByProject: {
          ...state.selectedOutlineByProject,
          [projectId]: storedOutlineId,
        },
      }));
    }
  },

  clearSelectedOutline: (projectId: string) => {
    set((state) => ({
      selectedOutlineByProject: {
        ...state.selectedOutlineByProject,
        [projectId]: undefined,
      },
    }));
    localStorage.removeItem(`selectedOutline_${projectId}`);
  },

  // Chapter selection
  selectChapter: (projectId: string, chapterId: string) => {
    set((state) => ({
      selectedChapterByProject: {
        ...state.selectedChapterByProject,
        [projectId]: chapterId,
      },
    }));
    localStorage.setItem(`selectedChapter_${projectId}`, chapterId);
  },

  getSelectedChapterId: (projectId: string) => {
    // First check state
    const stateChapterId = get().selectedChapterByProject[projectId];
    if (stateChapterId) return stateChapterId;

    // Fall back to localStorage (read-only, no state update during render)
    const storedChapterId = localStorage.getItem(`selectedChapter_${projectId}`);
    return storedChapterId || undefined;
  },

  // Sync localStorage value to state (call this in useEffect, not during render)
  syncChapterFromStorage: (projectId: string) => {
    const stateChapterId = get().selectedChapterByProject[projectId];
    if (stateChapterId) return; // Already in state

    const storedChapterId = localStorage.getItem(`selectedChapter_${projectId}`);
    if (storedChapterId) {
      set((state) => ({
        selectedChapterByProject: {
          ...state.selectedChapterByProject,
          [projectId]: storedChapterId,
        },
      }));
    }
  },

  clearSelectedChapter: (projectId: string) => {
    set((state) => ({
      selectedChapterByProject: {
        ...state.selectedChapterByProject,
        [projectId]: undefined,
      },
    }));
    localStorage.removeItem(`selectedChapter_${projectId}`);
  },

  // Modal states
  setAIEditModalOpen: (open: boolean) => {
    set({ isAIEditModalOpen: open });
  },

  setVersionModalOpen: (open: boolean) => {
    set({ isVersionModalOpen: open });
  },

  setSettingsOpen: (open: boolean) => {
    set({ isSettingsOpen: open });
  },

  // Editor state
  setEditorContent: (projectId: string, content: string) => {
    set((state) => ({
      editorContentByProject: {
        ...state.editorContentByProject,
        [projectId]: content,
      },
    }));
  },

  getEditorContent: (projectId: string) => {
    return get().editorContentByProject[projectId] ?? '';
  },

  setIsSaving: (projectId: string, saving: boolean) => {
    set((state) => ({
      isSavingByProject: {
        ...state.isSavingByProject,
        [projectId]: saving,
      },
    }));
  },

  getIsSaving: (projectId: string) => {
    return get().isSavingByProject[projectId] ?? false;
  },

  setHasUnsavedChanges: (projectId: string, hasChanges: boolean) => {
    set((state) => ({
      hasUnsavedChangesByProject: {
        ...state.hasUnsavedChangesByProject,
        [projectId]: hasChanges,
      },
    }));
  },

  getHasUnsavedChanges: (projectId: string) => {
    return get().hasUnsavedChangesByProject[projectId] ?? false;
  },

  // Reset project state
  resetProjectState: (projectId: string) => {
    set((state) => {
      const newState = { ...state };
      delete newState.selectedOutlineByProject[projectId];
      delete newState.selectedChapterByProject[projectId];
      delete newState.editorContentByProject[projectId];
      delete newState.isSavingByProject[projectId];
      delete newState.hasUnsavedChangesByProject[projectId];
      return newState;
    });
    localStorage.removeItem(`selectedOutline_${projectId}`);
    localStorage.removeItem(`selectedChapter_${projectId}`);
  },
}));
