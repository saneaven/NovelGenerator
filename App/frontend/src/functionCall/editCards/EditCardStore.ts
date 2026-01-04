/**
 * EditCard Store
 *
 * Zustand store for managing EditCard state with O(1) lookups.
 * Uses nested Map structure for efficient access.
 */

import { create } from 'zustand';
import type { EditCard, ApplicationResult, FunctionCallFailureType } from '../types';

// ============================================================================
// STORE STATE INTERFACE
// ============================================================================

interface EditCardState {
  /** Map<messageId, Map<cardId, EditCard>> for O(1) lookup (Agent flow) */
  cardsByMessage: Map<string, Map<string, EditCard>>;

  /** Map<sessionId, Map<cardId, EditCard>> for O(1) lookup (AI Edit flow) */
  cardsBySession: Map<string, Map<string, EditCard>>;

  /** Map<messageId, boolean> for tracking confirmed messages */
  confirmedMessages: Map<string, boolean>;

  /** Map<sessionId, boolean> for tracking confirmed sessions */
  confirmedSessions: Map<string, boolean>;

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

  // ==================== SESSION-BASED ACTIONS (AI Edit flow) ====================

  /** Set all cards for a session (replaces existing) */
  setCardsForSession: (sessionId: string, cards: EditCard[]) => void;

  /** Get all cards for a session */
  getCardsForSession: (sessionId: string) => EditCard[];

  /** Clear all cards for a session */
  clearSession: (sessionId: string) => void;

  /** Mark session as confirmed */
  confirmSession: (sessionId: string) => void;

  /** Check if session is confirmed */
  isSessionConfirmed: (sessionId: string) => boolean;

  /** Apply result to a session card */
  applySessionResult: (
    sessionId: string,
    cardId: string,
    result: ApplicationResult,
    newTitle?: string,
    newDescription?: string
  ) => void;

  /** Mark session card as rejected */
  rejectSessionCard: (sessionId: string, cardId: string, rejectionMessage?: string) => void;

  /** Set failure on session card */
  setSessionApplyError: (sessionId: string, cardId: string, error: string, failureType?: FunctionCallFailureType) => void;

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

  /** Set failure on card */
  setApplyError: (messageId: string, cardId: string, error: string, failureType?: FunctionCallFailureType) => void;

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
  cardsBySession: new Map(),
  confirmedMessages: new Map(),
  confirmedSessions: new Map(),

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
    set({
      cardsByMessage: new Map(),
      cardsBySession: new Map(),
      confirmedMessages: new Map(),
      confirmedSessions: new Map(),
    });
  },

  // ==================== SESSION-BASED IMPLEMENTATIONS ====================

  setCardsForSession: (sessionId, cards) => {
    set(state => {
      const newMap = new Map(state.cardsBySession);
      const cardMap = new Map<string, EditCard>();
      cards.forEach(card => cardMap.set(card.id, card));
      newMap.set(sessionId, cardMap);
      return { cardsBySession: newMap };
    });
  },

  getCardsForSession: (sessionId) => {
    const sessionCards = get().cardsBySession.get(sessionId);
    if (!sessionCards) return [];
    return Array.from(sessionCards.values());
  },

  clearSession: (sessionId) => {
    set(state => {
      const newMap = new Map(state.cardsBySession);
      newMap.delete(sessionId);

      const newConfirmed = new Map(state.confirmedSessions);
      newConfirmed.delete(sessionId);

      return { cardsBySession: newMap, confirmedSessions: newConfirmed };
    });
  },

  confirmSession: (sessionId) => {
    set(state => {
      const newConfirmed = new Map(state.confirmedSessions);
      newConfirmed.set(sessionId, true);
      return { confirmedSessions: newConfirmed };
    });
  },

  isSessionConfirmed: (sessionId) => {
    return get().confirmedSessions.get(sessionId) ?? false;
  },

  applySessionResult: (sessionId, cardId, result, newTitle, newDescription) => {
    set(state => {
      const sessionCards = state.cardsBySession.get(sessionId);
      if (!sessionCards) return state;

      const card = sessionCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        title: newTitle ?? (result.success ? 'Applied' : 'Apply Failed'),
        description: newDescription ?? result.message,
        functionCall: {
          ...card.functionCall,
          status: result.success ? 'accepted' : 'failed',
          result,
          acceptedAt: result.success ? new Date() : undefined,
          reason: result.success ? undefined : result.error,
          failureType: result.success ? undefined : 'execution',
        },
      };

      const newSessionCards = new Map(sessionCards);
      newSessionCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsBySession);
      newMap.set(sessionId, newSessionCards);

      return { cardsBySession: newMap };
    });
  },

  rejectSessionCard: (sessionId, cardId, rejectionMessage) => {
    set(state => {
      const sessionCards = state.cardsBySession.get(sessionId);
      if (!sessionCards) return state;

      const card = sessionCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        title: 'Rejected by User',
        description: rejectionMessage ?? 'User rejected this function call',
        functionCall: {
          ...card.functionCall,
          status: 'rejected',
          reason: rejectionMessage,
          acceptedAt: new Date(),
        },
      };

      const newSessionCards = new Map(sessionCards);
      newSessionCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsBySession);
      newMap.set(sessionId, newSessionCards);

      return { cardsBySession: newMap };
    });
  },

  setSessionApplyError: (sessionId, cardId, error, failureType = 'execution') => {
    set(state => {
      const sessionCards = state.cardsBySession.get(sessionId);
      if (!sessionCards) return state;

      const card = sessionCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        functionCall: {
          ...card.functionCall,
          status: 'failed',
          reason: error,
          failureType,
        },
      };

      const newSessionCards = new Map(sessionCards);
      newSessionCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsBySession);
      newMap.set(sessionId, newSessionCards);

      return { cardsBySession: newMap };
    });
  },

  // ==================== MESSAGE-BASED APPLY/REJECT ====================

  applyResult: (messageId, cardId, result, newTitle, newDescription) => {
    set(state => {
      const messageCards = state.cardsByMessage.get(messageId);
      if (!messageCards) return state;

      const card = messageCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        title: newTitle ?? (result.success ? 'Applied' : 'Apply Failed'),
        description: newDescription ?? result.message,
        functionCall: {
          ...card.functionCall,
          status: result.success ? 'accepted' : 'failed',
          result,
          acceptedAt: result.success ? new Date() : undefined,
          reason: result.success ? undefined : result.error,
          failureType: result.success ? undefined : 'execution',
        },
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
        title: 'Rejected by User',
        description: rejectionMessage ?? 'User rejected this function call',
        functionCall: {
          ...card.functionCall,
          status: 'rejected',
          reason: rejectionMessage,
          acceptedAt: new Date(),
        },
      };

      const newMessageCards = new Map(messageCards);
      newMessageCards.set(cardId, updatedCard);

      const newMap = new Map(state.cardsByMessage);
      newMap.set(messageId, newMessageCards);

      return { cardsByMessage: newMap };
    });
  },

  setApplyError: (messageId, cardId, error, failureType = 'execution') => {
    set(state => {
      const messageCards = state.cardsByMessage.get(messageId);
      if (!messageCards) return state;

      const card = messageCards.get(cardId);
      if (!card) return state;

      const updatedCard: EditCard = {
        ...card,
        functionCall: {
          ...card.functionCall,
          status: 'failed',
          reason: error,
          failureType,
        },
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

/**
 * Get cards for a session as a hook
 */
export function useCardsForSession(sessionId: string): EditCard[] {
  return useEditCardStore(state => {
    const sessionCards = state.cardsBySession.get(sessionId);
    if (!sessionCards) return [];
    return Array.from(sessionCards.values());
  });
}

/**
 * Check if session is confirmed as a hook
 */
export function useIsSessionConfirmed(sessionId: string): boolean {
  return useEditCardStore(state => state.confirmedSessions.get(sessionId) ?? false);
}
