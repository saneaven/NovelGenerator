/**
 * Agent Hooks
 *
 * Unified agent orchestration hooks for Workspace and NovelEditor pages.
 */

// Main orchestration hook
export { useAgentOrchestration } from './useAgentOrchestration';

// Types
export type {
  AgentMode,
  AgentOrchestrationConfig,
  AgentOrchestrationReturn,
  FunctionCallState,
  FunctionCallHandlers,
  ContextIdState,
  AgentHandlersReturn,
} from './types';
