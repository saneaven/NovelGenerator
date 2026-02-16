import { create } from 'zustand';
import type { ChatMessage, TokenUsage } from '../llm/requestTypes';
import type { ToolCallSchema } from '../toolCall';
import type { EditingTargets } from '../llmTaskJourney/types';
import { useLLMSessionStore } from './llmSessionStore';

/**
 * JourneyStore - Permanent storage for Journey data
 *
 * Journeys are multi-turn AI conversations (AI Edit, Translate, etc.)
 * journeyStore persists journey data throughout the session.
 */

export type JourneyKind = 'aiEdit' | 'translateObjects' | 'imagePrompt' | 'sceneImage';

export type JourneyStatus =
  | 'idle'
  | 'running'
  | 'pending_confirmation'
  | 'applying'
  | 'success'
  | 'error'
  | 'cancelled';

export interface JourneyProgress {
  current: number;
  total: number;
  currentItemLabel?: string;
}

export interface Journey<TInput = unknown, TResult = unknown> {
  id: string;
  kind: JourneyKind;
  input: TInput;
  runId?: string;

  // Status
  status: JourneyStatus;

  // Journey-specific data (no preConversation - LLMTask handles templates)
  editingTargets: EditingTargets;
  tools?: ToolCallSchema[];
  messages: ChatMessage[];  // All messages (user input + assistant outputs)

  // Reference to current session for streaming data
  activeSessionId?: string;
  // Optional history of attempts (oldest -> newest)
  sessionHistory?: string[];

  // Result
  result?: TResult;
  error?: string;
  warning?: string;

  // LLM metadata
  provider?: string;
  model?: string;
  usage?: TokenUsage;
  progress?: JourneyProgress;

  // Metadata
  label: string;
  createdAt: number;
  updatedAt: number;
}

type AnyJourney = Journey<any, any>;

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

  // Query helpers
  getJourneyById: (id: string) => AnyJourney | undefined;
  getActiveJourneys: () => AnyJourney[];
  hasRunning: () => boolean;

  // Cancellation (delegates to activeSessionId)
  cancelJourney: (id: string) => void;

  // Message editing
  updateMessage: (journeyId: string, messageId: string, newContent: string) => void;
  deleteMessage: (journeyId: string, messageId: string) => void;
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

  // Query helpers
  getJourneyById: (id) => get().journeys[id],

  getActiveJourneys: () => {
    const { journeys } = get();
    return Object.values(journeys)
      .filter((j): j is AnyJourney => j !== undefined && j.status !== 'idle')
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  hasRunning: () => {
    const { journeys } = get();
    return Object.values(journeys).some(
      (j) => j !== undefined && j.status === 'running'
    );
  },

  // Cancellation (delegates to activeSessionId)
  cancelJourney: (id) => {
    // 1) Abort the current session (if any)
    const journey = get().journeys[id];
    const sessionId = journey?.activeSessionId;
    if (sessionId) {
      useLLMSessionStore.getState().cancelSession(sessionId);
    }

    // 2) Update status to cancelled
    set((state) => {
      const existing = state.journeys[id];
      if (!existing) return state;
      return {
        journeys: {
          ...state.journeys,
          [id]: {
            ...existing,
            status: 'cancelled',
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  // Message editing
  updateMessage: (journeyId, messageId, newContent) =>
    set((state) => {
      const journey = state.journeys[journeyId];
      if (!journey) return state;

      const updatedMessages = journey.messages.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          contentParts: msg.contentParts.map((part) =>
            part.type === 'content' ? { ...part, text: newContent } : part
          ),
        };
      });

      return {
        journeys: {
          ...state.journeys,
          [journeyId]: {
            ...journey,
            messages: updatedMessages,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  deleteMessage: (journeyId, messageId) =>
    set((state) => {
      const journey = state.journeys[journeyId];
      if (!journey) return state;

      return {
        journeys: {
          ...state.journeys,
          [journeyId]: {
            ...journey,
            messages: journey.messages.filter((msg) => msg.id !== messageId),
            updatedAt: Date.now(),
          },
        },
      };
    }),
}));
