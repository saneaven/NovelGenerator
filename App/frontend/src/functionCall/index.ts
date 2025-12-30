/**
 * Function Call System
 *
 * Unified system for handling LLM function calls.
 *
 * Main exports:
 * - UnifiedApplicator: Apply function calls to the store
 * - schemaRegistry: Single source of truth for function schemas
 * - useEditCardStore: Zustand store for EditCard state
 * - buildEditCard: Build EditCard from function call
 */

// Core types
export type {
  FunctionCategory,
  TargetType,
  StoryObjectSubtype,
  ExecutionMode,
  RawFunctionCall,
  NormalizedFunctionCall,
  FunctionCallWithStatus,
  PatchRetryContext,
  ApplicationResult,
  ExecutionContext,
  FunctionHandler,
  HandlerMetadata,
  JsonSchema,
  FunctionSchema,
  ValidationResult,
  EditCard,
} from './types';

export { STORY_OBJECT_TYPE_MAP, getObjectData } from './types';

// Schemas
export { schemaRegistry } from './schemas';
export {
  CRUD_FUNCTION_NAMES,
  REPLACE_FUNCTION_NAMES,
  PATCH_FUNCTION_NAMES,
  TRANSLATION_FUNCTION_NAMES,
  isTranslationFunction,
  isCrudFunction,
  isReplaceFunction,
  isPatchFunction,
  STORY_OBJECT_EDIT_FUNCTIONS,
  MANUSCRIPT_EDIT_FUNCTIONS,
} from './schemas';

// Normalizer
export {
  validateFunctionCall,
  normalizeFunctionCall,
  normalizeFunctionCalls,
  normalizeAndValidate,
  isKnownFunction,
  getIdFromArgs,
} from './normalizer';

// Native Output Converter
export { convertNativeOutputToFunctionCalls } from './nativeOutputConverter';

// Applicator
export { UnifiedApplicator, createApplicator } from './applicator';
export type {
  StoreActions,
  TranslationActions,
  TranslationInput,
  ApplicatorConfig,
  HandlerContext,
  Handler,
} from './applicator';

// Applicator utilities
export { createStoreActions, createApplicatorWithStore, useApplicator } from './applicator';

// Retry utilities
export {
  getPatchRetryConfig,
  buildRetryPrompt,
  buildForceReplaceSystemPrompt,
  shouldRetry,
  summarizePatchFailures,
} from './applicator';
export type { PatchRetryConfig, PatchRetryResult } from './applicator';

// EditCards
export {
  useEditCardStore,
  useCardsForMessage,
  useIsMessageConfirmed,
  getEditType,
  getFunctionTitle,
  getFunctionDescription,
  getFunctionDisplayName,
  generateFunctionSummary,
  buildEditCard,
  buildEditCards,
} from './editCards';
