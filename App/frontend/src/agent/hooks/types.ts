/**
 * Agent Orchestration Hook Types
 *
 * Types for the unified agent orchestration hook that consolidates
 * agent management, function call handling, and context management.
 */

import type { MutableRefObject } from 'react';
import type { AgentManager } from '../processors/AgentManager';
import type { EditCard } from '../../functionCall/types';
import type { FunctionCallMetadata, FunctionCallProgress } from '../../llm/requestTypes';

/**
 * Agent mode - only affects systemPrompt template selection
 */
export type AgentMode = 'storyObject' | 'novelEditor' | 'outlineManager';

/**
 * Configuration for the agent orchestration hook
 */
export interface AgentOrchestrationConfig {
  /** Project ID */
  projectId: string | undefined;
  /** Agent mode - only affects systemPrompt template selection */
  mode: AgentMode;
}

/**
 * Function call state returned by the orchestration hook
 */
export interface FunctionCallState {
  /** EditCards organized by message ID */
  messageEditCards: Record<string, EditCard[]>;
  /** Active streaming function calls by message ID */
  activeFunctionCalls: Record<string, FunctionCallProgress[]>;
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
  /** Ref to current context IDs (for AgentManager closure) */
  selectedContextIdsRef: MutableRefObject<string[]>;
  /** Total count of objects in the project */
  totalObjectCount: number;
}

/**
 * Agent handlers returned by the orchestration hook
 */
export interface AgentHandlersReturn {
  /** Ref to the edit textarea */
  editTextareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** Handle agent selection */
  handleSelectAgent: (agentId: string) => void;
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
 * Full return type of the agent orchestration hook
 */
export interface AgentOrchestrationReturn {
  /** The AgentManager instance */
  agentManager: AgentManager | null;
  /** Abort controller ref for the AgentManager */
  abortControllerRef: MutableRefObject<AbortController | null>;
  /** Agent interaction handlers */
  agentHandlers: AgentHandlersReturn;
  /** Function call state */
  functionCallState: FunctionCallState;
  /** Function call handlers */
  functionCallHandlers: FunctionCallHandlers;
  /** Context ID management */
  contextIds: ContextIdState;
}
