/**
 * Chat Orchestration Hook Types
 *
 * Types for the unified chat orchestration hook that consolidates
 * chat management, function call handling, and context management.
 */

import type { MutableRefObject } from 'react';
import type { ChatManager } from '../processors/ChatManager';
import type { EditCard } from '../../functionCall/types';
import type { FunctionCallMetadata, FunctionCallProgress, FunctionCallResultSummary } from '../../llm/requestTypes';

/**
 * Chat mode - only affects systemPrompt template selection
 */
export type ChatMode = 'workspace' | 'novelEditor';

/**
 * Configuration for the chat orchestration hook
 */
export interface ChatOrchestrationConfig {
  /** Project ID */
  projectId: string | undefined;
  /** Chat mode - only affects systemPrompt template selection */
  mode: ChatMode;
}

/**
 * Function call state returned by the orchestration hook
 */
export interface FunctionCallState {
  /** EditCards organized by message ID */
  messageEditCards: Record<string, EditCard[]>;
  /** Active streaming function calls by message ID */
  activeFunctionCalls: Record<string, FunctionCallProgress[]>;
  /** Pending function call results for next prompt */
  pendingFunctionCallResults: FunctionCallResultSummary[];
}

/**
 * Function call handlers returned by the orchestration hook
 */
export interface FunctionCallHandlers {
  /** Handle batch confirmation of function calls for a message */
  handleBatchConfirm: (messageId: string, selections: Record<string, boolean>) => Promise<void>;
  /** Check if a message's function calls are confirmed */
  isMessageConfirmed: (messageId: string) => boolean;
  /** Create apply handler for a single function call */
  createApplyHandler: (messageId: string, functionCall: FunctionCallMetadata) => () => Promise<void>;
  /** Create reject handler for a single function call */
  createRejectHandler: (messageId: string, functionCall: FunctionCallMetadata) => () => Promise<void>;
  /** Handle incoming function calls from LLM response */
  handleFunctionCalls: (messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  /** Handle function call progress during streaming */
  handleFunctionCallProgress: (messageId: string, progressList: FunctionCallProgress[]) => void;
  /** Register a session ID for a message (for error propagation to toast) */
  registerSessionForMessage: (messageId: string, sessionId: string) => void;
  /** Set pending function call results */
  setPendingFunctionCallResults: (results: FunctionCallResultSummary[]) => void;
  /** Clear pending function call results */
  clearPendingResults: () => void;
  /** Set message EditCards (for restoration) */
  setMessageEditCards: (cards: Record<string, EditCard[]>) => void;
  /** Set confirmed messages (for restoration) */
  setConfirmedMessages: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}

/**
 * Context ID management state returned by the orchestration hook
 */
export interface ContextIdState {
  /** Currently selected context object IDs */
  selectedContextIds: string[];
  /** Setter for selected context IDs */
  setSelectedContextIds: React.Dispatch<React.SetStateAction<string[]>>;
  /** Ref to current context IDs (for ChatManager closure) */
  selectedContextIdsRef: MutableRefObject<string[]>;
  /** Total count of objects in the project */
  totalObjectCount: number;
}

/**
 * Chat handlers returned by the orchestration hook
 */
export interface ChatHandlersReturn {
  /** Ref to the edit textarea */
  editTextareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** Handle chat selection */
  handleSelectChat: (chatId: string) => void;
  /** Handle form submission */
  handleSubmit: (e: React.FormEvent, input: string) => Promise<void>;
  /** Handle stop/abort */
  handleStop: () => void;
  /** Handle starting edit on a message */
  handleEditMessage: (messageId: string, content: string, language: string) => void;
  /** Handle edit content change */
  handleEditContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Handle saving edit */
  handleSaveEdit: () => void;
  /** Handle canceling edit */
  handleCancelEdit: () => void;
  /** Handle deleting a message */
  handleDeleteMessage: (messageId: string) => void;
}

/**
 * Full return type of the chat orchestration hook
 */
export interface ChatOrchestrationReturn {
  /** The ChatManager instance */
  chatManager: ChatManager | null;
  /** Abort controller ref for the ChatManager */
  abortControllerRef: MutableRefObject<AbortController | null>;
  /** Chat interaction handlers */
  chatHandlers: ChatHandlersReturn;
  /** Function call state */
  functionCallState: FunctionCallState;
  /** Function call handlers */
  functionCallHandlers: FunctionCallHandlers;
  /** Context ID management */
  contextIds: ContextIdState;
}
