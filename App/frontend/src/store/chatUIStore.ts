import { create } from 'zustand';

/**
 * ChatUIStore - UI State for Chat Components
 *
 * This store handles all chat-related UI state shared between
 * NovelEditor and Workspace pages:
 * - Chat panel visibility
 * - Loading states
 * - Input text
 * - Message editing state
 * - Sidebar visibility
 *
 * Note: Chat data (messages, chats) is managed by chatStore.
 * Note: Selected chat ID remains in chatStore for data operations.
 */

interface EditingState {
  messageId: string | null;
  language: string | null;
  content: string;
}

interface ChatUIState {
  // Per-project visibility state
  chatVisibleByProject: Record<string, boolean>;
  mobileSidebarVisibleByProject: Record<string, boolean>;
  desktopChatListVisibleByProject: Record<string, boolean>;

  // Per-project loading state
  loadingByProject: Record<string, boolean>;

  // Per-project input state
  inputByProject: Record<string, string>;

  // Per-project editing state
  editingByProject: Record<string, EditingState>;
}

interface ChatUIActions {
  // Chat visibility
  setChatVisible: (projectId: string, visible: boolean) => void;
  isChatVisible: (projectId: string) => boolean;
  toggleChatVisible: (projectId: string) => void;

  // Mobile sidebar visibility
  setMobileSidebarVisible: (projectId: string, visible: boolean) => void;
  isMobileSidebarVisible: (projectId: string) => boolean;

  // Desktop chat list visibility
  setDesktopChatListVisible: (projectId: string, visible: boolean) => void;
  isDesktopChatListVisible: (projectId: string) => boolean;

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
  mobileSidebarVisibleByProject: {},
  desktopChatListVisibleByProject: {},
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

  // Mobile sidebar visibility
  setMobileSidebarVisible: (projectId: string, visible: boolean) => {
    set((state) => ({
      mobileSidebarVisibleByProject: {
        ...state.mobileSidebarVisibleByProject,
        [projectId]: visible,
      },
    }));
  },

  isMobileSidebarVisible: (projectId: string) => {
    return get().mobileSidebarVisibleByProject[projectId] ?? false;
  },

  // Desktop chat list visibility
  setDesktopChatListVisible: (projectId: string, visible: boolean) => {
    set((state) => ({
      desktopChatListVisibleByProject: {
        ...state.desktopChatListVisibleByProject,
        [projectId]: visible,
      },
    }));
  },

  isDesktopChatListVisible: (projectId: string) => {
    return get().desktopChatListVisibleByProject[projectId] ?? false;
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
      delete newState.mobileSidebarVisibleByProject[projectId];
      delete newState.desktopChatListVisibleByProject[projectId];
      delete newState.loadingByProject[projectId];
      delete newState.inputByProject[projectId];
      delete newState.editingByProject[projectId];
      return newState;
    });
  },
}));
