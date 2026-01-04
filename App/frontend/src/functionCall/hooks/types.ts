/**
 * Function Call Handlers Hook Types
 *
 * Types for the common function call handling hook used by both
 * Agent (message-based) and AI Edit (session-based) flows.
 */

import type { EditCard } from '../types';
import type { FunctionCallMetadata, FunctionCallProgress } from '../../llm/requestTypes';

/**
 * Configuration for the function call handlers hook
 */
export interface UseFunctionCallHandlersConfig {
  /** Project ID for store operations */
  projectId: string;

  /** Language for content operations */
  language: string;

  /**
   * Storage mode:
   * - 'message': Cards stored by messageId (Agent flow)
   * - 'session': Cards stored by sessionId (AI Edit flow)
   */
  storageMode: 'message' | 'session';

  /**
   * Callback when function call status changes (Agent only)
   * Used to sync status back to backend
   */
  onUpdateStatus?: (
    storageKey: string,
    functionCallId: string,
    status: FunctionCallMetadata['status'],
    options?: {
      result?: any;
      reason?: string;
      failureType?: 'validation' | 'execution';
    }
  ) => void;

  /**
   * Callback to register session for error propagation (Agent only)
   */
  onRegisterSession?: (storageKey: string, sessionId: string) => void;

  /**
   * Get session ID for error propagation (Agent only)
   */
  getSessionId?: (storageKey: string) => string | undefined;
}

/**
 * State returned by the function call handlers hook
 */
export interface FunctionCallHandlersState {
  /** EditCards organized by storage key (messageId or sessionId) */
  editCards: Record<string, EditCard[]>;

  /** Active streaming function calls by storage key */
  activeFunctionCalls: Record<string, FunctionCallProgress[]>;
}

/**
 * Handlers returned by the function call handlers hook
 */
export interface FunctionCallHandlersActions {
  /**
   * Handle incoming function calls from LLM response
   * Runs async validation and builds EditCards
   */
  handleFunctionCalls: (
    storageKey: string,
    functionCalls: FunctionCallMetadata[]
  ) => Promise<void>;

  /**
   * Handle function call progress during streaming
   */
  handleFunctionCallProgress: (
    storageKey: string,
    progressList: FunctionCallProgress[]
  ) => void;

  /**
   * Create apply handler for a single function call
   */
  createApplyHandler: (
    storageKey: string,
    functionCall: FunctionCallMetadata
  ) => () => Promise<void>;

  /**
   * Create reject handler for a single function call
   */
  createRejectHandler: (
    storageKey: string,
    functionCall: FunctionCallMetadata
  ) => (reason?: string) => Promise<void>;

  /**
   * Handle batch confirmation
   */
  handleBatchConfirm: (
    storageKey: string,
    selections: Record<string, boolean>
  ) => Promise<void>;

  /**
   * Check if a message/session is confirmed
   */
  isConfirmed: (storageKey: string) => boolean;

  /**
   * Set EditCards directly (for restoration)
   */
  setEditCards: (cards: Record<string, EditCard[]>) => void;

  /**
   * Set confirmed status (for restoration)
   */
  setConfirmedKeys: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>
  ) => void;

  /**
   * Clear cards for a storage key
   */
  clearCards: (storageKey: string) => void;
}

/**
 * Return type of the function call handlers hook
 */
export interface UseFunctionCallHandlersReturn {
  state: FunctionCallHandlersState;
  actions: FunctionCallHandlersActions;
}
