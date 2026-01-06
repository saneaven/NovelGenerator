/**
 * Function Call System
 *
 * Unified system for handling LLM function calls.
 *
 * Main exports:
 * - UnifiedApplicator: Apply function calls to the store
 * - schemaRegistry: Single source of truth for function schemas
 * - buildEditCard: Build EditCard from function call
 */

// Core types
export type {
  FunctionCategory,
  TargetType,
  StoryObjectSubtype,
  ExecutionMode,
  FunctionCallStatus,
  FunctionCallFailureType,
  RawFunctionCall,
  NormalizedFunctionCall,
  FunctionCallWithStatus,
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
  isCrudFunction,
  isReplaceFunction,
  isPatchFunction,
  STORY_OBJECT_EDIT_FUNCTIONS,
  MANUSCRIPT_EDIT_FUNCTIONS,
  OUTLINE_EDIT_FUNCTIONS,
  // Agent functions
  AGENT_FUNCTIONS,
  AGENT_FUNCTION_NAMES,
  getFunctionsForSet,
  type FunctionSetName,
  // Legacy types for LLM module compatibility
  type FunctionCallSchema,
  type FunctionCallResult,
  type FunctionCallMessage,
  type FunctionResultMessage,
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
  ApplicatorConfig,
  HandlerContext,
  Handler,
} from './applicator';

// Applicator utilities
export { createStoreActions, createApplicatorWithStore, useApplicator } from './applicator';

// EditCards
export {
  getEditType,
  getFunctionTitle,
  getFunctionDescription,
  getFunctionDisplayName,
  generateFunctionSummary,
  buildEditCard,
  buildEditCards,
  buildEditCardsFromFunctionCallMetadata,
  applyValidationResults,
} from './editCards';
export type { BuildEditCardOptions, BuildEditCardsOptions } from './editCards';

// Validation
export { validate, validateOne } from './validation';
export type { ValidationResult as AsyncValidationResult, Validator } from './validation';
