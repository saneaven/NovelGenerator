/**
 * Agent Hooks
 *
 * Unified agent orchestration hooks for Workspace and NovelEditor pages.
 */

// Main orchestration hook
export { useAgentOrchestration } from './useAgentOrchestration';

// Types
export type {
  AgentOrchestrationConfig,
  AgentOrchestrationReturn,
  ContextIdState,
  AgentHandlersReturn,
} from './types';
