import { create } from 'zustand';

/**
 * AgentUIStore - UI State for Agent Components
 *
 * This store handles agent-related UI state shared between
 * NovelEditor and Workspace pages:
 * - Agent panel visibility
 * - Loading states
 * - Input text
 * - Message editing state
 *
 * Note: Agent data (messages, agents) is managed by agentStore.
 * Note: Selected agent ID remains in agentStore for data operations.
 * Note: Sidebar visibility is now managed by sidebarStore.
 */

interface EditingState {
  messageId: string | null;
  language: string | null;
  content: string;
}

interface AgentUIState {
  // Per-project visibility state (agent panel only - sidebar visibility is in sidebarStore)
  agentVisibleByProject: Record<string, boolean>;

  // Per-project loading state
  loadingByProject: Record<string, boolean>;

  // Per-project input state
  inputByProject: Record<string, string>;

  // Per-project editing state
  editingByProject: Record<string, EditingState>;

  // Modal state for agent detail modal
  detailSessionId: string | null;
}

interface AgentUIActions {
  // Agent panel visibility (not sidebar - that's in sidebarStore)
  setAgentVisible: (projectId: string, visible: boolean) => void;
  isAgentVisible: (projectId: string) => boolean;
  toggleAgentVisible: (projectId: string) => void;

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

  // Modal management
  openDetailModal: (sessionId: string) => void;
  closeDetailModal: () => void;
}

type AgentUIStore = AgentUIState & AgentUIActions;

const defaultEditingState: EditingState = {
  messageId: null,
  language: null,
  content: '',
};

const initialState: AgentUIState = {
  agentVisibleByProject: {},
  loadingByProject: {},
  inputByProject: {},
  editingByProject: {},
  detailSessionId: null,
};

export const useAgentUIStore = create<AgentUIStore>()((set, get) => ({
  ...initialState,

  // Agent visibility
  setAgentVisible: (projectId: string, visible: boolean) => {
    set((state) => ({
      agentVisibleByProject: {
        ...state.agentVisibleByProject,
        [projectId]: visible,
      },
    }));
  },

  isAgentVisible: (projectId: string) => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    if (isDesktop) return true; // Always show agent on desktop
    const stored = get().agentVisibleByProject[projectId];
    return stored ?? false; // Use stored state on mobile, default to hidden
  },

  toggleAgentVisible: (projectId: string) => {
    const current = get().isAgentVisible(projectId);
    get().setAgentVisible(projectId, !current);
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
      delete newState.agentVisibleByProject[projectId];
      delete newState.loadingByProject[projectId];
      delete newState.inputByProject[projectId];
      delete newState.editingByProject[projectId];
      return newState;
    });
  },

  // Modal management
  openDetailModal: (sessionId: string) => {
    set({ detailSessionId: sessionId });
  },

  closeDetailModal: () => {
    set({ detailSessionId: null });
  },
}));
