/**
 * Agent Orchestration Hook Types
 *
 * Types for the unified agent orchestration hook that consolidates
 * agent management, function call handling, and context management.
 */

import type { MutableRefObject } from 'react';

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
 * Context ID management state returned by the orchestration hook
 */
export interface ContextIdState {
  /** Currently selected context object IDs */
  selectedContextIds: string[];
  /** Setter for selected context IDs */
  setSelectedContextIds: React.Dispatch<React.SetStateAction<string[]>>;
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
  /** Trigger auto-continue after function call confirmation */
  triggerAutoContinue: () => Promise<void>;
}

/**
 * Full return type of the agent orchestration hook
 */
export interface AgentOrchestrationReturn {
  /** Agent interaction handlers */
  agentHandlers: AgentHandlersReturn;
  /** Context ID management */
  contextIds: ContextIdState;
}
