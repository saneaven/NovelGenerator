/**
 * Handler exports
 */

export { CRUD_HANDLERS } from './CrudHandlers';
export { REPLACE_HANDLERS } from './ReplaceHandlers';
export { PATCH_HANDLERS } from './PatchHandlers';
export { READ_HANDLERS } from './ReadHandlers';

import type { Handler } from '../types';
import { CRUD_HANDLERS } from './CrudHandlers';
import { REPLACE_HANDLERS } from './ReplaceHandlers';
import { PATCH_HANDLERS } from './PatchHandlers';
import { READ_HANDLERS } from './ReadHandlers';

/**
 * All handlers combined into a single registry
 */
export const ALL_HANDLERS: Record<string, Handler> = {
  ...CRUD_HANDLERS,
  ...REPLACE_HANDLERS,
  ...PATCH_HANDLERS,
  ...READ_HANDLERS,
};
