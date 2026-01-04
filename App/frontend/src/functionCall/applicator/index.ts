/**
 * Applicator exports
 */

export { UnifiedApplicator, createApplicator } from './UnifiedApplicator';
export type {
  StoreActions,
  ApplicatorConfig,
  HandlerContext,
  Handler,
  HandlerEntry,
} from './types';
export { ALL_HANDLERS } from './handlers';

// Shared utilities
export { createStoreActions, createApplicatorWithStore, useApplicator } from './utils';
