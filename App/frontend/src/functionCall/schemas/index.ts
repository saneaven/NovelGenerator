/**
 * Schema exports
 */

export {
  schemaRegistry,
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
  // Legacy types
  type FunctionCallSchema,
  type FunctionCallResult,
  type FunctionCallMessage,
  type FunctionResultMessage,
} from './schemaRegistry';

export {
  STORY_OBJECT_TYPES,
  TRANSLATION_OBJECT_TYPES,
  CHAPTER_TYPES,
} from './schemaBuilders';
