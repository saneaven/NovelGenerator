import { create } from 'zustand';
import type { ChatMessage, TokenUsage } from '../llm/requestTypes';
import type { FunctionCallSchema } from '../functionCall';
import type { StoredEditCard } from '../llmTask/uiTypes';
import type { EditingTargets } from '../llmTaskJourney/types';

/**
 * JourneyStore - Permanent storage for Journey data
 *
 * Journeys are multi-turn AI conversations (AI Edit, Translate, etc.)
 * Unlike llmTaskStore (temporary execution tracking), journeyStore
 * persists journey data throughout the session.
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

  // Status
  status: JourneyStatus;

  // Journey-specific data (no preConversation - LLMTask handles templates)
  editingTargets: EditingTargets;
  functions?: FunctionCallSchema[];
  messages: ChatMessage[];  // All messages (user input + assistant outputs)

  // Reference to llmTaskStore session for streaming data
  sessionId?: string;

  // Function call confirmation
  editCards?: StoredEditCard[];

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
  isRead: boolean;
}

// AbortController registry (outside Zustand store to avoid serialization issues)
const abortControllers = new Map<string, AbortController>();

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
  hasUnread: () => boolean;
  hasRunning: () => boolean;

  // Notification actions
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;

  // Abort controller management
  registerAbortController: (id: string, controller: AbortController) => void;
  unregisterAbortController: (id: string) => void;
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

  hasUnread: () => {
    const { journeys } = get();
    return Object.values(journeys).some(
      (j) => j !== undefined && j.status !== 'idle' && !j.isRead
    );
  },

  hasRunning: () => {
    const { journeys } = get();
    return Object.values(journeys).some(
      (j) => j !== undefined && j.status === 'running'
    );
  },

  // Notification actions
  markAsRead: (id) =>
    set((state) => {
      const existing = state.journeys[id];
      if (!existing) return state;
      return {
        journeys: {
          ...state.journeys,
          [id]: { ...existing, isRead: true },
        },
      };
    }),

  markAllAsRead: () =>
    set((state) => {
      const updated: Record<string, AnyJourney | undefined> = {};
      for (const [id, journey] of Object.entries(state.journeys)) {
        if (journey) {
          updated[id] = { ...journey, isRead: true };
        }
      }
      return { journeys: updated };
    }),

  // Abort controller management
  registerAbortController: (id, controller) => {
    abortControllers.set(id, controller);
  },

  unregisterAbortController: (id) => {
    abortControllers.delete(id);
  },

  cancelJourney: (id) => {
    // 1. Abort the request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    // 2. Update status to cancelled
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
