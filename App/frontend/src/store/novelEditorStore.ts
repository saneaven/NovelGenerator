import { create } from 'zustand';

/**
 * NovelEditorStore - UI State for Novel Editor
 *
 * This store handles all UI state for the novel editor:
 * - Selected chapter per project
 * - Modal visibility states
 * - Editor content and saving state
 * - Display preferences
 *
 * All manuscript (content) data is managed by unifiedObjectStore.
 */

export type StoryTabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

interface NovelEditorUIState {
  // Outline selection per project
  selectedOutlineByProject: Record<string, string | undefined>;

  // Chapter selection per project
  selectedChapterByProject: Record<string, string | undefined>;

  // UI visibility per project (sidebar visibility is now in sidebarStore)
  chatVisibleByProject: Record<string, boolean>;

  // Modal states (global - one at a time)
  isAIEditModalOpen: boolean;
  isVersionModalOpen: boolean;
  isSettingsOpen: boolean;

  // Editor state per project
  editorContentByProject: Record<string, string>;
  isSavingByProject: Record<string, boolean>;
  hasUnsavedChangesByProject: Record<string, boolean>;

  // Display preferences per project (displayLanguage moved to settingsStore)
  activeStoryTabByProject: Record<string, StoryTabType>;
}

interface NovelEditorActions {
  // Outline selection
  selectOutline: (projectId: string, outlineId: string) => void;
  getSelectedOutlineId: (projectId: string) => string | undefined;
  clearSelectedOutline: (projectId: string) => void;

  // Chapter selection
  selectChapter: (projectId: string, chapterId: string) => void;
  getSelectedChapterId: (projectId: string) => string | undefined;
  clearSelectedChapter: (projectId: string) => void;

  // UI visibility (sidebar visibility is now in sidebarStore)
  setChatVisible: (projectId: string, visible: boolean) => void;
  isChatVisible: (projectId: string) => boolean;

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

  // Display preferences (displayLanguage moved to settingsStore)
  setActiveStoryTab: (projectId: string, tab: StoryTabType) => void;
  getActiveStoryTab: (projectId: string) => StoryTabType;

  // Reset project state
  resetProjectState: (projectId: string) => void;
}

type NovelEditorStore = NovelEditorUIState & NovelEditorActions;

const initialState: NovelEditorUIState = {
  selectedOutlineByProject: {},
  selectedChapterByProject: {},
  chatVisibleByProject: {},
  isAIEditModalOpen: false,
  isVersionModalOpen: false,
  isSettingsOpen: false,
  editorContentByProject: {},
  isSavingByProject: {},
  hasUnsavedChangesByProject: {},
  activeStoryTabByProject: {},
};

export const useNovelEditorStore = create<NovelEditorStore>()((set, get) => ({
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
    const stateOutlineId = get().selectedOutlineByProject[projectId];
    if (stateOutlineId) return stateOutlineId;

    const storedOutlineId = localStorage.getItem(`selectedOutline_${projectId}`);
    if (storedOutlineId) {
      set((state) => ({
        selectedOutlineByProject: {
          ...state.selectedOutlineByProject,
          [projectId]: storedOutlineId,
        },
      }));
      return storedOutlineId;
    }

    return undefined;
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
    const stateChapterId = get().selectedChapterByProject[projectId];
    if (stateChapterId) return stateChapterId;

    const storedChapterId = localStorage.getItem(`selectedChapter_${projectId}`);
    if (storedChapterId) {
      set((state) => ({
        selectedChapterByProject: {
          ...state.selectedChapterByProject,
          [projectId]: storedChapterId,
        },
      }));
      return storedChapterId;
    }

    return undefined;
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

  // UI visibility (sidebar visibility is now in sidebarStore)
  setChatVisible: (projectId: string, visible: boolean) => {
    set((state) => ({
      chatVisibleByProject: {
        ...state.chatVisibleByProject,
        [projectId]: visible,
      },
    }));
  },

  isChatVisible: (projectId: string) => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    if (isDesktop) return true; // Always show chat on desktop
    const stored = get().chatVisibleByProject[projectId];
    return stored ?? false; // Use stored state on mobile, default to hidden
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

  // Display preferences (displayLanguage moved to settingsStore)
  setActiveStoryTab: (projectId: string, tab: StoryTabType) => {
    set((state) => ({
      activeStoryTabByProject: {
        ...state.activeStoryTabByProject,
        [projectId]: tab,
      },
    }));
  },

  getActiveStoryTab: (projectId: string) => {
    return get().activeStoryTabByProject[projectId] ?? 'basicInfo';
  },

  // Reset project state
  resetProjectState: (projectId: string) => {
    set((state) => {
      const newState = { ...state };
      delete newState.selectedOutlineByProject[projectId];
      delete newState.selectedChapterByProject[projectId];
      delete newState.chatVisibleByProject[projectId];
      delete newState.editorContentByProject[projectId];
      delete newState.isSavingByProject[projectId];
      delete newState.hasUnsavedChangesByProject[projectId];
      delete newState.activeStoryTabByProject[projectId];
      return newState;
    });
    localStorage.removeItem(`selectedOutline_${projectId}`);
    localStorage.removeItem(`selectedChapter_${projectId}`);
  },
}));
