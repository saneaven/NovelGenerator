/**
 * Tool Call System — types and UI only.
 * Plumbing (schemas, validation, normalizer, viewModel, editCards, apply, runtime)
 * has been deleted and will be reimplemented.
 */

// Core types
export type {
  ToolCategory,
  TargetType,
  StoryEntityKind,
  ExecutionMode,
  ToolCallStatus,
  ToolCallFailureType,
  ToolCallDecision,
  ToolCallDecisionMap,
  RawToolCall,
  NormalizedToolCall,
  ToolCallWithStatus,
  ApplicationResult,
  ExecutionContext,
  ToolHandler,
  HandlerMetadata,
  JsonSchema,
  ToolSchema,
  ValidationResult,
  EditCard,
} from './types';

export { getObjectData } from './types';

// EditCard builder (simplified, no normalizer/validator dependency)
export { buildEditCardsFromToolCallMetadata } from './editCardBuilder';

// UI
export * from './ui';
