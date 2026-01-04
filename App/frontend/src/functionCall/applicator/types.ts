/**
 * Applicator Types
 *
 * Interfaces for dependency injection into the UnifiedApplicator.
 * This allows the applicator to work with real stores or mocks for testing.
 */

import type { ObjectType, UnifiedObject, UpdateObjectRequest } from '../../types/unifiedObject';
import type { ExecutionContext, ApplicationResult } from '../types';

// ============================================================================
// STORE ACTIONS INTERFACE
// ============================================================================

/**
 * Minimal store interface for dependency injection.
 * Abstracts the unified object store operations needed by handlers.
 */
export interface StoreActions {
  // Object access
  getObject: (id: string) => UnifiedObject | null;

  // CRUD operations
  fetchObject: (type: ObjectType, id: string) => Promise<void>;
  listObjects: (type: ObjectType, projectId: string) => Promise<UnifiedObject[]>;
  createObject: (
    type: ObjectType,
    projectId: string,
    data: Record<string, unknown>,
    language: string,
    metadata?: Record<string, unknown>,
    userRequest?: string
  ) => Promise<UnifiedObject>;
  updateObject: (
    type: ObjectType,
    id: string,
    request: UpdateObjectRequest
  ) => Promise<void>;
  deleteObject: (type: ObjectType, id: string) => Promise<void>;
}

// ============================================================================
// APPLICATOR CONFIGURATION
// ============================================================================

/**
 * Configuration for the UnifiedApplicator
 */
export interface ApplicatorConfig {
  /** Store actions for object operations */
  store: StoreActions;
}

// ============================================================================
// HANDLER CONTEXT
// ============================================================================

/**
 * Context passed to each handler
 * Combines execution context with dependencies
 *
 * Note: For translation handlers, pass the target language as `language`.
 * Translation uses `create_new_version: false` while CRUD uses `true`.
 */
export interface HandlerContext extends ExecutionContext {
  store: StoreActions;
}

/**
 * Options for handler functions to control versioning and request type.
 * Used to share logic between CRUD and Translation handlers.
 */
export interface HandlerOptions {
  /** Whether to create a new version (CRUD: true, Translation: false) */
  createNewVersion?: boolean;
  /** User request label for the operation */
  userRequest?: string;
}

/** Default options for CRUD operations */
export const CRUD_OPTIONS: HandlerOptions = {
  createNewVersion: true,
  userRequest: 'AI Edit',
};

/** Default options for Translation operations */
export const TRANSLATION_OPTIONS: HandlerOptions = {
  createNewVersion: false,
  userRequest: 'AI Translation',
};

/**
 * Handler function signature with context
 */
export type Handler = (
  args: Record<string, unknown>,
  context: HandlerContext
) => Promise<ApplicationResult>;

/**
 * Handler registry entry
 */
export interface HandlerEntry {
  name: string;
  handler: Handler;
}
