/**
 * Chat Hooks
 *
 * Unified chat orchestration hooks for Workspace and NovelEditor pages.
 */

// Main orchestration hook
export { useChatOrchestration } from './useChatOrchestration';

// Types
export type {
  ChatMode,
  ChatOrchestrationConfig,
  ChatOrchestrationReturn,
  FunctionCallState,
  FunctionCallHandlers,
  ContextIdState,
  ChatHandlersReturn,
} from './types';
