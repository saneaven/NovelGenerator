import { create } from 'zustand';
import type { EditingTargets } from '../llmTaskJourney/types';

/**
 * JourneyStore - Metadata-only storage for Journey data.
 *
 * Messages, tool calls, and run status are read directly from ThreadStore.
 * JourneyStore only holds journey-specific metadata (kind, input, editingTargets, label)
 * and modal state.
 */

export type JourneyKind =
  | 'manuscriptEdit'
  | 'outlineEdit'
  | 'objectEdit'
  | 'objectTranslation'
  | 'imagePrompt'
  | 'sceneImagePrompt'
  | 'messageTranslation';

export interface Journey<TInput = unknown> {
  id: string;
  kind: JourneyKind;
  input: TInput;
  threadId?: string;

  editingTargets: EditingTargets;
  label: string;

  /** Only set when dispatch fails before threadId is obtained. */
  error?: string;

  createdAt: number;
  updatedAt: number;
}

type AnyJourney = Journey<any>;

interface JourneyStore {
  // Data
  journeys: Record<string, AnyJourney | undefined>;

  // Modal state
  detailJourneyId: string | null;
  openDetailModal: (id: string) => void;
  closeDetailModal: () => void;

  // CRUD
  createJourney: (journey: AnyJourney) => void;
  updateJourney: (id: string, partial: Partial<Omit<AnyJourney, 'id' | 'kind' | 'input'>>) => void;
  clearJourney: (id: string) => void;
  clearByThreadId: (threadId: string) => void;
  clearByThreadIds: (threadIds: string[]) => void;

  // Query helpers
  getJourneyById: (id: string) => AnyJourney | undefined;
  getActiveJourneys: () => AnyJourney[];
}

export const useJourneyStore = create<JourneyStore>((set, get) => ({
  journeys: {},

  // Modal state
  detailJourneyId: null,
  openDetailModal: (id) => set({ detailJourneyId: id }),
  closeDetailModal: () => set({ detailJourneyId: null }),

  // CRUD
  createJourney: (journey) =>
    set((state) => ({
      journeys: {
        ...state.journeys,
        [journey.id]: journey,
      },
    })),

  updateJourney: (id, partial) =>
    set((state) => {
      const existing = state.journeys[id];
      if (!existing) return state;

      return {
        journeys: {
          ...state.journeys,
          [id]: {
            ...existing,
            ...partial,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearJourney: (id) =>
    set((state) => {
      if (!state.journeys[id]) {
        return state;
      }
      const next = { ...state.journeys };
      delete next[id];

      // Also close modal if this journey was being viewed
      const detailJourneyId = state.detailJourneyId === id ? null : state.detailJourneyId;

      return { journeys: next, detailJourneyId };
    }),

  clearByThreadId: (threadId) =>
    set((state) => clearJourneysByThreadIdsState(state, [threadId])),

  clearByThreadIds: (threadIds) =>
    set((state) => clearJourneysByThreadIdsState(state, threadIds)),

  // Query helpers
  getJourneyById: (id) => get().journeys[id],

  getActiveJourneys: () => {
    const { journeys } = get();
    return Object.values(journeys)
      .filter((j): j is AnyJourney => j !== undefined && j.threadId !== undefined)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
}));

function clearJourneysByThreadIdsState(
  state: JourneyStore,
  threadIds: string[],
): Partial<JourneyStore> | JourneyStore {
  if (threadIds.length === 0) return state;
  const toDelete = new Set(threadIds);
  let changed = false;
  const next: Record<string, AnyJourney | undefined> = {};
  let detailJourneyId = state.detailJourneyId;

  for (const [journeyId, journey] of Object.entries(state.journeys)) {
    if (journey && journey.threadId && toDelete.has(journey.threadId)) {
      changed = true;
      if (detailJourneyId === journeyId) {
        detailJourneyId = null;
      }
      continue;
    }
    next[journeyId] = journey;
  }

  return changed ? { journeys: next, detailJourneyId } : state;
}
