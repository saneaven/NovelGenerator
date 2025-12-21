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
// TRANSLATION SERVICE INTERFACE
// ============================================================================

/**
 * Translation input for batch translation operations
 */
export interface TranslationInput {
  objectType: ObjectType;
  objectId: string;
  language: string;
  data: Record<string, unknown>;
}

/**
 * Translation service interface for dependency injection
 */
export interface TranslationActions {
  addTranslations: (translations: TranslationInput[]) => Promise<{ objects: UnifiedObject[] }>;
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
  /** Optional translation service for translation mode */
  translationService?: TranslationActions;
}

// ============================================================================
// HANDLER CONTEXT
// ============================================================================

/**
 * Context passed to each handler
 * Combines execution context with dependencies
 */
export interface HandlerContext extends ExecutionContext {
  store: StoreActions;
  translationService?: TranslationActions;
}

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
