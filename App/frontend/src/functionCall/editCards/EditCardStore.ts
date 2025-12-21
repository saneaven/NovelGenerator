/**
 * EditCard Store
 *
 * Zustand store for managing EditCard state with O(1) lookups.
 * Uses nested Map structure for efficient access.
 */

import { create } from 'zustand';
import type { EditCard, ApplicationResult } from '../types';

// ============================================================================
// STORE STATE INTERFACE
// ============================================================================

interface EditCardState {
  /** Map<messageId, Map<cardId, EditCard>> for O(1) lookup */
  cardsByMessage: Map<string, Map<string, EditCard>>;

  /** Map<messageId, boolean> for tracking confirmed messages */
  confirmedMessages: Map<string, boolean>;

  // ==================== ACTIONS ====================

  /** Set all cards for a message (replaces existing) */
  setCardsForMessage: (messageId: string, cards: EditCard[]) => void;

  /** Update a single card */
  updateCard: (messageId: string, cardId: string, updates: Partial<EditCard>) => void;

  /** Get all cards for a message */
  getCardsForMessage: (messageId: string) => EditCard[];

  /** Get a single card */
  getCard: (messageId: string, cardId: string) => EditCard | undefined;

  /** Clear all cards for a message */
  clearMessage: (messageId: string) => void;

  /** Clear all cards */
  clearAll: () => void;

  // ==================== APPLY/REJECT ====================

  /** Apply result to a card */
  applyResult: (
    messageId: string,
    cardId: string,
    result: ApplicationResult,
    newTitle?: string,
    newDescription?: string
  ) => void;

  /** Mark card as rejected */
  rejectCard: (messageId: string, cardId: string, rejectionMessage?: string) => void;

  /** Set apply error on card (keeps pending) */
  setApplyError: (messageId: string, cardId: string, error: string) => void;

  // ==================== CONFIRMATION ====================

  /** Mark message as confirmed */
  confirmMessage: (messageId: string) => void;

  /** Check if message is confirmed */
  isMessageConfirmed: (messageId: string) => boolean;
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useEditCardStore = create<EditCardState>((set, get) => ({
  cardsByMessage: new Map(),
  confirmedMessages: new Map(),

  setCardsForMessage: (messageId, cards) => {
    set(state => {
      const newMap = new Map(state.cardsByMessage);
      const cardMap = new Map<string, EditCard>();
      cards.forEach(card => cardMap.set(card.id, card));
      newMap.set(messageId, cardMap);
      return { cardsByMessage: newMap };
    });
  },

  updateCard: (messageId, cardId, updates) => {
    set(state => {
      const messageCards = state.cardsByMessage.get(messageId);
      if (!messageCards) return state;

      const card = messageCards.get(cardId);
      if (!card) return state;

      const newMessageCards = new Map(messageCards);
      newMessageCards.set(cardId, { ...card, ...updates });

      const newMap = new Map(state.cardsByMessage);
      newMap.set(messageId, newMessageCards);

      return { cardsByMessage: newMap };
    });
  },

  getCardsForMessage: (messageId) => {
    const messageCards = get().cardsByMessage.get(messageId);
    if (!messageCards) return [];
    return Array.from(messageCards.values());
  },

  getCard: (messageId, cardId) => {
    const messageCards = get().cardsByMessage.get(messageId);
    if (!messageCards) return undefined;
    return messageCards.get(cardId);
  },

  clearMessage: (messageId) => {
    set(state => {
      const newMap = new Map(state.cardsByMessage);
      newMap.delete(messageId);

      const newConfirmed = new Map(state.confirmedMessages);
      newConfirmed.delete(messageId);

      return { cardsByMessage: newMap, confirmedMessages: newConfirmed };
    });
  },

  clearAll: () => {
    set({ cardsByMessage: new Map(), confirmedMessages: new Map() });
  },

  applyResult: (messageId, cardId, result, newTitle, newDescription) => {
    set(state => {
      const messageCards = state.cardsByMessage.get(messageId);
      if (!messageCards) return state;

      const card = messageCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        isApplied: true,
        appliedAt: new Date(),
        title: newTitle ?? (result.success ? 'Applied' : 'Apply Failed'),
        description: newDescription ?? result.message,
        applyError: result.success ? undefined : result.error,
      };

      const newMessageCards = new Map(messageCards);
      newMessageCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsByMessage);
      newMap.set(messageId, newMessageCards);

      return { cardsByMessage: newMap };
    });
  },

  rejectCard: (messageId, cardId, rejectionMessage) => {
    set(state => {
      const messageCards = state.cardsByMessage.get(messageId);
      if (!messageCards) return state;

      const card = messageCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        isApplied: true,
        isRejected: true,
        appliedAt: new Date(),
        title: 'Rejected by User',
        description: rejectionMessage ?? 'User rejected this function call',
      };

      const newMessageCards = new Map(messageCards);
      newMessageCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsByMessage);
      newMap.set(messageId, newMessageCards);

      return { cardsByMessage: newMap };
    });
  },

  setApplyError: (messageId, cardId, error) => {
    set(state => {
      const messageCards = state.cardsByMessage.get(messageId);
      if (!messageCards) return state;

      const card = messageCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        applyError: error,
        // Keep isApplied: false - card stays pending
      };

      const newMessageCards = new Map(messageCards);
      newMessageCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsByMessage);
      newMap.set(messageId, newMessageCards);

      return { cardsByMessage: newMap };
    });
  },

  confirmMessage: (messageId) => {
    set(state => {
      const newConfirmed = new Map(state.confirmedMessages);
      newConfirmed.set(messageId, true);
      return { confirmedMessages: newConfirmed };
    });
  },

  isMessageConfirmed: (messageId) => {
    return get().confirmedMessages.get(messageId) ?? false;
  },
}));

// ============================================================================
// SELECTORS
// ============================================================================

/**
 * Get cards for a message as a hook
 */
export function useCardsForMessage(messageId: string): EditCard[] {
  return useEditCardStore(state => {
    const messageCards = state.cardsByMessage.get(messageId);
    if (!messageCards) return [];
    return Array.from(messageCards.values());
  });
}

/**
 * Check if message is confirmed as a hook
 */
export function useIsMessageConfirmed(messageId: string): boolean {
  return useEditCardStore(state => state.confirmedMessages.get(messageId) ?? false);
}
