/**
 * Applicator Utilities
 *
 * Shared utilities for creating and using the UnifiedApplicator.
 * Consolidates duplicated code from multiple locations.
 */

import { useMemo } from 'react';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { StoreActions } from './types';
import { UnifiedApplicator } from './UnifiedApplicator';

/**
 * Create StoreActions adapter from Zustand store state.
 *
 * This is a pure function that creates the adapter from store state.
 * Use this when you need the adapter outside of React components.
 *
 * @param store - The unified object store state (from getState())
 * @returns StoreActions adapter for UnifiedApplicator
 */
export function createStoreActions(
  store: ReturnType<typeof useUnifiedObjectStore.getState>
): StoreActions {
  return {
    getObject: (id) => store.getObject(id),
    fetchObject: (type, id) => store.fetchObject(type, id),
    listObjects: (type, projectId) => store.listObjects(type, projectId),
    createObject: (type, projectId, data, language, metadata, userRequest) =>
      store.createObject(type, projectId, data, language, metadata, userRequest),
    updateObject: (type, id, request) => store.updateObject(type, id, request),
    deleteObject: (type, id) => store.deleteObject(type, id),
  };
}

/**
 * Create a UnifiedApplicator with store actions.
 *
 * Convenience function for non-React contexts.
 * For React components, prefer useApplicator() hook.
 *
 * @returns Configured UnifiedApplicator instance
 */
export function createApplicatorWithStore(): UnifiedApplicator {
  const storeActions = createStoreActions(useUnifiedObjectStore.getState());
  return new UnifiedApplicator({ store: storeActions });
}

/**
 * React hook to get a memoized UnifiedApplicator instance.
 *
 * The applicator is memoized and reuses the same instance across renders.
 * Store actions are created from the current store state at creation time.
 *
 * @returns Memoized UnifiedApplicator instance
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const applicator = useApplicator();
 *
 *   const handleApply = async (functionCall) => {
 *     const result = await applicator.apply(functionCall, {
 *       projectId,
 *       language,
 *     });
 *   };
 * }
 * ```
 */
export function useApplicator(): UnifiedApplicator {
  return useMemo(() => {
    const storeActions = createStoreActions(useUnifiedObjectStore.getState());
    return new UnifiedApplicator({ store: storeActions });
  }, []);
}
