import { create } from 'zustand';

/**
 * ChatUIStore - UI State for Chat Components
 *
 * This store handles chat-related UI state shared between
 * NovelEditor and Workspace pages:
 * - Chat panel visibility
 * - Loading states
 * - Input text
 * - Message editing state
 *
 * Note: Chat data (messages, chats) is managed by chatStore.
 * Note: Selected chat ID remains in chatStore for data operations.
 * Note: Sidebar visibility is now managed by sidebarStore.
 */

interface EditingState {
  messageId: string | null;
  language: string | null;
  content: string;
}

interface ChatUIState {
  // Per-project visibility state (chat panel only - sidebar visibility is in sidebarStore)
  chatVisibleByProject: Record<string, boolean>;

  // Per-project loading state
  loadingByProject: Record<string, boolean>;

  // Per-project input state
  inputByProject: Record<string, string>;

  // Per-project editing state
  editingByProject: Record<string, EditingState>;
}

interface ChatUIActions {
  // Chat panel visibility (not sidebar - that's in sidebarStore)
  setChatVisible: (projectId: string, visible: boolean) => void;
  isChatVisible: (projectId: string) => boolean;
  toggleChatVisible: (projectId: string) => void;

  // Loading state
  setLoading: (projectId: string, loading: boolean) => void;
  isLoading: (projectId: string) => boolean;

  // Input state
  setInput: (projectId: string, input: string) => void;
  getInput: (projectId: string) => string;
  clearInput: (projectId: string) => void;

  // Message editing
  startEditing: (projectId: string, messageId: string, language: string, content: string) => void;
  updateEditContent: (projectId: string, content: string) => void;
  cancelEditing: (projectId: string) => void;
  getEditing: (projectId: string) => EditingState;
  isEditing: (projectId: string) => boolean;

  // Reset
  resetProjectState: (projectId: string) => void;
}

type ChatUIStore = ChatUIState & ChatUIActions;

const defaultEditingState: EditingState = {
  messageId: null,
  language: null,
  content: '',
};

const initialState: ChatUIState = {
  chatVisibleByProject: {},
  loadingByProject: {},
  inputByProject: {},
  editingByProject: {},
};

export const useChatUIStore = create<ChatUIStore>()((set, get) => ({
  ...initialState,

  // Chat visibility
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

  toggleChatVisible: (projectId: string) => {
    const current = get().isChatVisible(projectId);
    get().setChatVisible(projectId, !current);
  },

  // Loading state
  setLoading: (projectId: string, loading: boolean) => {
    set((state) => ({
      loadingByProject: {
        ...state.loadingByProject,
        [projectId]: loading,
      },
    }));
  },

  isLoading: (projectId: string) => {
    return get().loadingByProject[projectId] ?? false;
  },

  // Input state
  setInput: (projectId: string, input: string) => {
    set((state) => ({
      inputByProject: {
        ...state.inputByProject,
        [projectId]: input,
      },
    }));
  },

  getInput: (projectId: string) => {
    return get().inputByProject[projectId] ?? '';
  },

  clearInput: (projectId: string) => {
    set((state) => ({
      inputByProject: {
        ...state.inputByProject,
        [projectId]: '',
      },
    }));
  },

  // Message editing
  startEditing: (projectId: string, messageId: string, language: string, content: string) => {
    set((state) => ({
      editingByProject: {
        ...state.editingByProject,
        [projectId]: {
          messageId,
          language,
          content,
        },
      },
    }));
  },

  updateEditContent: (projectId: string, content: string) => {
    set((state) => ({
      editingByProject: {
        ...state.editingByProject,
        [projectId]: {
          ...state.editingByProject[projectId],
          content,
        },
      },
    }));
  },

  cancelEditing: (projectId: string) => {
    set((state) => ({
      editingByProject: {
        ...state.editingByProject,
        [projectId]: defaultEditingState,
      },
    }));
  },

  getEditing: (projectId: string) => {
    return get().editingByProject[projectId] ?? defaultEditingState;
  },

  isEditing: (projectId: string) => {
    return get().editingByProject[projectId]?.messageId !== null;
  },

  // Reset project state
  resetProjectState: (projectId: string) => {
    set((state) => {
      const newState = { ...state };
      delete newState.chatVisibleByProject[projectId];
      delete newState.loadingByProject[projectId];
      delete newState.inputByProject[projectId];
      delete newState.editingByProject[projectId];
      return newState;
    });
  },
}));
