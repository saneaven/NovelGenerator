import { create } from 'zustand';

export type RagTypeGroup = 'story_object' | 'outline' | 'manuscript';

export interface RagSearchResult {
  chunk_id: string;
  source_id: string;
  object_type: string;
  object_id: string;

  type_group: RagTypeGroup | string;
  story_object_type?: string | null;
  story_object_order?: number | null;
  outline_order?: number | null;
  act_order?: number | null;
  chapter_order?: number | null;
  chapter_id?: string | null;

  field_path: string;
  chunk_index: number;
  text: string;

  distance?: number | null;
}

export interface RagSearchPayload {
  queries: string[];
  results: RagSearchResult[];
  receivedAt: string;
}

interface RagStore {
  resultsByProject: Record<string, RagSearchPayload | undefined>;

  setResults: (projectId: string, payload: RagSearchPayload) => void;
  clearResults: (projectId: string) => void;
}

export const useRagStore = create<RagStore>((set) => ({
  resultsByProject: {},

  setResults: (projectId, payload) =>
    set((state) => ({
      resultsByProject: { ...state.resultsByProject, [projectId]: payload },
    })),

  clearResults: (projectId) =>
    set((state) => {
      const next = { ...state.resultsByProject };
      delete next[projectId];
      return { resultsByProject: next };
    }),
}));

