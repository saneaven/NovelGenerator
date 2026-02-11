import { create } from 'zustand';
import type { TemplateData } from '../llm/types';

export interface AgentPromptSnapshotEntry {
  projectData: TemplateData['project'];
  capturedAt: number;
}

interface AgentPromptSnapshotState {
  snapshots: Record<string, AgentPromptSnapshotEntry>;
}

interface AgentPromptSnapshotActions {
  get: (projectId: string, agentId: string) => AgentPromptSnapshotEntry | undefined;
  set: (projectId: string, agentId: string, entry: AgentPromptSnapshotEntry) => void;
  clearAgent: (projectId: string, agentId: string) => void;
  clearProject: (projectId: string) => void;
}

function makeKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

export const useAgentPromptSnapshotStore = create<AgentPromptSnapshotState & AgentPromptSnapshotActions>(
  (set, get) => ({
    snapshots: {},

    get: (projectId, agentId) => get().snapshots[makeKey(projectId, agentId)],

    set: (projectId, agentId, entry) =>
      set((state) => ({
        snapshots: { ...state.snapshots, [makeKey(projectId, agentId)]: entry },
      })),

    clearAgent: (projectId, agentId) =>
      set((state) => {
        const key = makeKey(projectId, agentId);
        if (!(key in state.snapshots)) return state;
        const { [key]: _, ...rest } = state.snapshots;
        return { snapshots: rest };
      }),

    clearProject: (projectId) =>
      set((state) => {
        const prefix = `${projectId}:`;
        const next: Record<string, AgentPromptSnapshotEntry> = {};
        for (const [key, value] of Object.entries(state.snapshots)) {
          if (!key.startsWith(prefix)) next[key] = value;
        }
        return { snapshots: next };
      }),
  })
);
