/**
 * Tool Call System
 *
 * Unified system for handling LLM tool calls.
 *
 * Main exports:
 * - schemaRegistry: Single source of truth for tool schemas
 * - buildEditCard: Build EditCard from tool call
 */

// Core types
export type {
  ToolCategory,
  TargetType,
  StoryObjectSubtype,
  ExecutionMode,
  ToolCallStatus,
  ToolCallFailureType,
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

export { STORY_OBJECT_TYPE_MAP, getObjectData } from './types';

// Schemas
export { schemaRegistry } from './schemas';
export {
  CRUD_TOOL_NAMES,
  REPLACE_TOOL_NAMES,
  PATCH_TOOL_NAMES,
  READ_TOOL_NAMES,
  isCrudTool,
  isReplaceTool,
  isPatchTool,
  isReadTool,
  STORY_OBJECT_EDIT_TOOLS,
  MANUSCRIPT_EDIT_TOOLS,
  OUTLINE_EDIT_TOOLS,
  // Agent tools
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  getToolsForSet,
  type ToolSetName,
  type ToolCallSchema,
} from './schemas';

// Normalizer
export {
  validateToolCall,
  normalizeToolCall,
  normalizeToolCalls,
  normalizeAndValidate,
  isKnownTool,
  getIdFromArgs,
} from './normalizer';

// EditCards
export {
  getEditType,
  getToolTitle,
  getToolDescription,
  getToolDisplayName,
  generateToolSummary,
  buildEditCard,
  buildEditCards,
  buildEditCardsFromToolCallMetadata,
  applyValidationResults,
} from './editCards';
export type { BuildEditCardOptions, BuildEditCardsOptions } from './editCards';

// Validation
export { validate, validateOne } from './validation';
export type { ValidationResult as AsyncValidationResult, Validator } from './validation';
