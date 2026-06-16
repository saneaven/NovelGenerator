import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentRunMode } from '../types/agentRuntime';

/**
 * Consolidated client UI store. Merges the former sidebarStore (sidebar
 * visibility), agentUIStore (agent panel UI), and timelineUiStore (track
 * visibility / tag filter). All fields/methods keep their original names so
 * consumers only swap the hook. Only the timeline hidden-track set is persisted
 * (preserving the original 'timeline-ui' key).
 */

// ---- sidebar ----------------------------------------------------------------
export type SidebarId = 'agent' | 'chapter' | string;

// ---- agent panel ------------------------------------------------------------
export type AgentPreflightToast = {
  type: 'info' | 'error';
  message: string;
};

const DEFAULT_PREFLIGHT_TOAST_DURATION_MS = 4000;
const preflightToastTimeouts: Record<string, number | undefined> = {};

function clearPreflightToastTimer(projectId: string): void {
  const timeoutId = preflightToastTimeouts[projectId];
  if (timeoutId === undefined) return;
  if (typeof window !== 'undefined') {
    window.clearTimeout(timeoutId);
  }
  delete preflightToastTimeouts[projectId];
}

export function makeProjectAgentKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

interface EditingState {
  messageId: string | null;
  language: string | null;
  content: string;
}

const defaultEditingState: EditingState = {
  messageId: null,
  language: null,
  content: '',
};

interface UiStore {
  // ---- sidebar visibility (one open at a time per project) ----
  openSidebarByProject: Record<string, SidebarId | null>;
  openSidebar: (projectId: string, sidebarId: SidebarId) => void;
  closeSidebar: (projectId: string) => void;
  toggleSidebar: (projectId: string, sidebarId: SidebarId) => void;
  isOpen: (projectId: string, sidebarId: SidebarId) => boolean;
  getOpenSidebar: (projectId: string) => SidebarId | null;

  // ---- agent panel UI ----
  agentVisibleByProject: Record<string, boolean>;
  loadingByProjectAgent: Record<string, boolean>;
  lastViewedAtByProjectAgent: Record<string, number>;
  inputByProject: Record<string, string>;
  editingByProject: Record<string, EditingState>;
  preflightToastByProject: Record<string, AgentPreflightToast | undefined>;
  runModeByProject: Record<string, AgentRunMode>;
  detailSessionId: string | null;

  setAgentVisible: (projectId: string, visible: boolean) => void;
  isAgentVisible: (projectId: string) => boolean;
  toggleAgentVisible: (projectId: string) => void;
  setLoading: (projectId: string, agentId: string, loading: boolean) => void;
  isLoading: (projectId: string, agentId: string) => boolean;
  markAgentViewed: (projectId: string, agentId: string, at?: number) => void;
  getLastViewedAt: (projectId: string, agentId: string) => number;
  setInput: (projectId: string, input: string) => void;
  getInput: (projectId: string) => string;
  clearInput: (projectId: string) => void;
  startEditing: (projectId: string, messageId: string, language: string, content: string) => void;
  updateEditContent: (projectId: string, content: string) => void;
  cancelEditing: (projectId: string) => void;
  getEditing: (projectId: string) => EditingState;
  isEditing: (projectId: string) => boolean;
  setPreflightToast: (projectId: string, toast: AgentPreflightToast | null) => void;
  showPreflightToast: (projectId: string, toast: AgentPreflightToast, durationMs?: number) => void;
  getPreflightToast: (projectId: string) => AgentPreflightToast | null;
  setRunMode: (projectId: string, runMode: AgentRunMode) => void;
  getRunMode: (projectId: string, defaultMode?: AgentRunMode) => AgentRunMode;
  toggleRunMode: (projectId: string) => void;
  openDetailModal: (sessionId: string) => void;
  closeDetailModal: () => void;

  // ---- timeline UI (track visibility / tag filter) ----
  hiddenTrackIdsByProject: Record<string, string[]>;
  dismissedWarningsKey: string | null;
  activeTagFilter: string[];
  isTrackHidden: (projectId: string, trackId: string) => boolean;
  toggleTrackHidden: (projectId: string, trackId: string) => void;
  showAllTracks: (projectId: string) => void;
  unhideAncestorChain: (projectId: string, trackPathIds: string[]) => void;
  pruneHiddenTracks: (projectId: string, existingTrackIds: ReadonlySet<string>) => void;
  setDismissedWarningsKey: (key: string | null) => void;
  setTagFilter: (tags: string[]) => void;

  // ---- unified reset (clears a project's sidebar + agent-panel UI) ----
  resetProjectState: (projectId: string) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      // ---- sidebar ----
      openSidebarByProject: {},
      openSidebar: (projectId, sidebarId) => {
        set((state) => ({
          openSidebarByProject: { ...state.openSidebarByProject, [projectId]: sidebarId },
        }));
      },
      closeSidebar: (projectId) => {
        set((state) => ({
          openSidebarByProject: { ...state.openSidebarByProject, [projectId]: null },
        }));
      },
      toggleSidebar: (projectId, sidebarId) => {
        const currentOpen = get().openSidebarByProject[projectId];
        if (currentOpen === sidebarId) get().closeSidebar(projectId);
        else get().openSidebar(projectId, sidebarId);
      },
      isOpen: (projectId, sidebarId) => get().openSidebarByProject[projectId] === sidebarId,
      getOpenSidebar: (projectId) => get().openSidebarByProject[projectId] ?? null,

      // ---- agent panel ----
      agentVisibleByProject: {},
      loadingByProjectAgent: {},
      lastViewedAtByProjectAgent: {},
      inputByProject: {},
      editingByProject: {},
      preflightToastByProject: {},
      runModeByProject: {},
      detailSessionId: null,

      setAgentVisible: (projectId, visible) => {
        set((state) => ({
          agentVisibleByProject: { ...state.agentVisibleByProject, [projectId]: visible },
        }));
      },
      isAgentVisible: (projectId) => {
        const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
        if (isDesktop) return true;
        const stored = get().agentVisibleByProject[projectId];
        return stored ?? false;
      },
      toggleAgentVisible: (projectId) => {
        get().setAgentVisible(projectId, !get().isAgentVisible(projectId));
      },
      setLoading: (projectId, agentId, loading) => {
        const key = makeProjectAgentKey(projectId, agentId);
        set((state) => ({ loadingByProjectAgent: { ...state.loadingByProjectAgent, [key]: loading } }));
      },
      isLoading: (projectId, agentId) => get().loadingByProjectAgent[makeProjectAgentKey(projectId, agentId)] ?? false,
      markAgentViewed: (projectId, agentId, at) => {
        const key = makeProjectAgentKey(projectId, agentId);
        const viewedAt = typeof at === 'number' ? at : Date.now();
        set((state) => ({ lastViewedAtByProjectAgent: { ...state.lastViewedAtByProjectAgent, [key]: viewedAt } }));
      },
      getLastViewedAt: (projectId, agentId) => get().lastViewedAtByProjectAgent[makeProjectAgentKey(projectId, agentId)] ?? 0,
      setInput: (projectId, input) => {
        set((state) => ({ inputByProject: { ...state.inputByProject, [projectId]: input } }));
      },
      getInput: (projectId) => get().inputByProject[projectId] ?? '',
      clearInput: (projectId) => {
        set((state) => ({ inputByProject: { ...state.inputByProject, [projectId]: '' } }));
      },
      startEditing: (projectId, messageId, language, content) => {
        set((state) => ({
          editingByProject: { ...state.editingByProject, [projectId]: { messageId, language, content } },
        }));
      },
      updateEditContent: (projectId, content) => {
        set((state) => ({
          editingByProject: {
            ...state.editingByProject,
            [projectId]: { ...state.editingByProject[projectId], content },
          },
        }));
      },
      cancelEditing: (projectId) => {
        set((state) => ({
          editingByProject: { ...state.editingByProject, [projectId]: defaultEditingState },
        }));
      },
      getEditing: (projectId) => get().editingByProject[projectId] ?? defaultEditingState,
      isEditing: (projectId) => get().editingByProject[projectId]?.messageId !== null,

      setPreflightToast: (projectId, toast) => {
        clearPreflightToastTimer(projectId);
        set((state) => ({
          preflightToastByProject: { ...state.preflightToastByProject, [projectId]: toast ?? undefined },
        }));
      },
      showPreflightToast: (projectId, toast, durationMs = DEFAULT_PREFLIGHT_TOAST_DURATION_MS) => {
        clearPreflightToastTimer(projectId);
        set((state) => ({
          preflightToastByProject: { ...state.preflightToastByProject, [projectId]: toast },
        }));
        if (durationMs <= 0 || typeof window === 'undefined') return;
        preflightToastTimeouts[projectId] = window.setTimeout(() => {
          delete preflightToastTimeouts[projectId];
          set((state) => ({
            preflightToastByProject: { ...state.preflightToastByProject, [projectId]: undefined },
          }));
        }, durationMs);
      },
      getPreflightToast: (projectId) => get().preflightToastByProject[projectId] ?? null,

      setRunMode: (projectId, runMode) => {
        set((state) => ({ runModeByProject: { ...state.runModeByProject, [projectId]: runMode } }));
      },
      getRunMode: (projectId, defaultMode = 'agentMode') => get().runModeByProject[projectId] ?? defaultMode,
      toggleRunMode: (projectId) => {
        const current = get().getRunMode(projectId);
        get().setRunMode(projectId, current === 'planMode' ? 'agentMode' : 'planMode');
      },

      openDetailModal: (sessionId) => set({ detailSessionId: sessionId }),
      closeDetailModal: () => set({ detailSessionId: null }),

      // ---- timeline UI ----
      hiddenTrackIdsByProject: {},
      dismissedWarningsKey: null,
      activeTagFilter: [],

      isTrackHidden: (projectId, trackId) => (get().hiddenTrackIdsByProject[projectId] ?? []).includes(trackId),
      toggleTrackHidden: (projectId, trackId) => {
        set((state) => {
          const current = state.hiddenTrackIdsByProject[projectId] ?? [];
          const next = current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId];
          return { hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: next } };
        });
      },
      showAllTracks: (projectId) => {
        set((state) => ({ hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: [] } }));
      },
      unhideAncestorChain: (projectId, trackPathIds) => {
        set((state) => {
          const current = state.hiddenTrackIdsByProject[projectId] ?? [];
          const remove = new Set(trackPathIds);
          const next = current.filter((id) => !remove.has(id));
          if (next.length === current.length) return state;
          return { hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: next } };
        });
      },
      pruneHiddenTracks: (projectId, existingTrackIds) => {
        set((state) => {
          const current = state.hiddenTrackIdsByProject[projectId] ?? [];
          const next = current.filter((id) => existingTrackIds.has(id));
          if (next.length === current.length) return state;
          return { hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: next } };
        });
      },
      setDismissedWarningsKey: (key) => set({ dismissedWarningsKey: key }),
      setTagFilter: (tags) => set({ activeTagFilter: [...new Set(tags.filter(Boolean))] }),

      // ---- unified reset ----
      resetProjectState: (projectId) => {
        clearPreflightToastTimer(projectId);
        set((state) => {
          const projectPrefix = `${projectId}:`;
          const nextLoading = { ...state.loadingByProjectAgent };
          const nextLastViewed = { ...state.lastViewedAtByProjectAgent };
          for (const key of Object.keys(nextLoading)) if (key.startsWith(projectPrefix)) delete nextLoading[key];
          for (const key of Object.keys(nextLastViewed)) if (key.startsWith(projectPrefix)) delete nextLastViewed[key];

          const nextAgentVisible = { ...state.agentVisibleByProject };
          const nextInput = { ...state.inputByProject };
          const nextEditing = { ...state.editingByProject };
          const nextPreflight = { ...state.preflightToastByProject };
          const nextRunMode = { ...state.runModeByProject };
          const { [projectId]: _omitSidebar, ...nextOpenSidebar } = state.openSidebarByProject;
          delete nextAgentVisible[projectId];
          delete nextInput[projectId];
          delete nextEditing[projectId];
          delete nextPreflight[projectId];
          delete nextRunMode[projectId];

          return {
            openSidebarByProject: nextOpenSidebar,
            agentVisibleByProject: nextAgentVisible,
            loadingByProjectAgent: nextLoading,
            lastViewedAtByProjectAgent: nextLastViewed,
            inputByProject: nextInput,
            editingByProject: nextEditing,
            preflightToastByProject: nextPreflight,
            runModeByProject: nextRunMode,
          };
        });
      },
    }),
    {
      name: 'timeline-ui',
      partialize: (state) => ({ hiddenTrackIdsByProject: state.hiddenTrackIdsByProject }),
    },
  ),
);

export default useUiStore;
