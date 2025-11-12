/**
 * Unified Object Store - Simplified
 *
 * NO MORE:
 * - Version cache
 * - Overlay logic
 * - Flat field syncing
 * - Complex language handling
 *
 * NOW:
 * - Simple CRUD operations
 * - Objects already in correct language from API
 * - Direct data access
 */

import { create } from 'zustand';
import { unifiedObjectService } from '../api/unifiedObjectService';
import type {
  UnifiedObject,
  ObjectType,
  UpdateObjectRequest,
  AddTranslationRequest,
  VersionHistoryEntry,
} from '../types/unifiedObject';

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface UnifiedObjectStore {
  // Simple object storage by ID
  objects: Record<string, UnifiedObject>;

  // Loading states
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  // CRUD Operations
  fetchObject: (type: ObjectType, id: string, language?: string) => Promise<void>;
  updateObject: (type: ObjectType, id: string, request: UpdateObjectRequest) => Promise<void>;
  addTranslation: (type: ObjectType, id: string, request: AddTranslationRequest) => Promise<void>;
  switchLanguage: (type: ObjectType, id: string, language: string) => Promise<void>;

  // Version management
  getVersions: (type: ObjectType, id: string) => Promise<VersionHistoryEntry[]>;
  activateVersion: (type: ObjectType, id: string, versionId: string) => Promise<void>;

  // Translation management
  deleteTranslation: (type: ObjectType, id: string, language: string) => Promise<void>;

  // List & Collection operations
  listObjects: (type: ObjectType, projectId: string, language?: string) => Promise<UnifiedObject[]>;
  createObject: (
    type: ObjectType,
    projectId: string,
    data: any,
    language: string,
    metadata?: Record<string, any>
  ) => Promise<UnifiedObject>;
  deleteObject: (type: ObjectType, id: string) => Promise<void>;

  // Utilities
  getObject: (id: string) => UnifiedObject | null;
  clearObject: (id: string) => void;
  clearAllObjects: () => void;
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useUnifiedObjectStore = create<UnifiedObjectStore>((set, get) => ({
  objects: {},
  loading: {},
  errors: {},

  // ========================================================================
  // FETCH OBJECT
  // ========================================================================

  fetchObject: async (type: ObjectType, id: string, language?: string) => {
    // Set loading
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      const object = await unifiedObjectService.getObject(type, id, language);

      set((state) => ({
        objects: { ...state.objects, [id]: object },
        loading: { ...state.loading, [id]: false },
      }));
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to fetch object' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // UPDATE OBJECT
  // ========================================================================

  updateObject: async (type: ObjectType, id: string, request: UpdateObjectRequest) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      const updatedObject = await unifiedObjectService.updateObject(type, id, request);

      set((state) => ({
        objects: { ...state.objects, [id]: updatedObject },
        loading: { ...state.loading, [id]: false },
      }));
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to update object' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // ADD TRANSLATION
  // ========================================================================

  addTranslation: async (type: ObjectType, id: string, request: AddTranslationRequest) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.addTranslation(type, id, request);

      // Refetch object to get updated language info
      await get().fetchObject(type, id, request.language);
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to add translation' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // SWITCH LANGUAGE
  // ========================================================================

  switchLanguage: async (type: ObjectType, id: string, language: string) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.switchActiveLanguage(type, id, { language });

      // Refetch object in new language
      await get().fetchObject(type, id, language);
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to switch language' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // VERSION MANAGEMENT
  // ========================================================================

  getVersions: async (type: ObjectType, id: string) => {
    try {
      const versions = await unifiedObjectService.getVersions(type, id);
      return versions;
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to fetch versions' },
      }));
      throw error;
    }
  },

  activateVersion: async (type: ObjectType, id: string, versionId: string) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.activateVersion(type, id, versionId);

      // Refetch object to get updated data
      const currentObject = get().objects[id];
      const currentLanguage = currentObject?.languages.active;
      await get().fetchObject(type, id, currentLanguage);
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to activate version' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // TRANSLATION MANAGEMENT
  // ========================================================================

  deleteTranslation: async (type: ObjectType, id: string, language: string) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.deleteTranslation(type, id, language);

      // Refetch object to get updated language list
      const currentObject = get().objects[id];
      const currentLanguage = currentObject?.languages.active;
      await get().fetchObject(type, id, currentLanguage);
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to delete translation' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // LIST & COLLECTION OPERATIONS
  // ========================================================================

  listObjects: async (type: ObjectType, projectId: string, language?: string) => {
    try {
      const response = await unifiedObjectService.listObjects(type, projectId, { language });

      // Store all objects in the objects map
      const objectsMap: Record<string, UnifiedObject> = {};
      response.objects.forEach((obj) => {
        objectsMap[obj.id] = obj;
      });

      set((state) => ({
        objects: { ...state.objects, ...objectsMap },
      }));

      return response.objects;
    } catch (error: any) {
      console.error('Failed to list objects:', error);
      throw error;
    }
  },

  createObject: async (type: ObjectType, projectId: string, data: any, language: string, metadata?: Record<string, any>) => {
    try {
      const newObject = await unifiedObjectService.createObject(type, projectId, {
        data,
        language,
        user_request: 'User Creation',
        metadata,
      });

      set((state) => ({
        objects: { ...state.objects, [newObject.id]: newObject },
        loading: { ...state.loading, [newObject.id]: false },
      }));

      return newObject;
    } catch (error: any) {
      console.error('Failed to create object:', error);
      throw error;
    }
  },

  deleteObject: async (type: ObjectType, id: string) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.deleteObject(type, id);

      // Remove object from store
      set((state) => {
        const newObjects = { ...state.objects };
        const newLoading = { ...state.loading };
        const newErrors = { ...state.errors };

        delete newObjects[id];
        delete newLoading[id];
        delete newErrors[id];

        return { objects: newObjects, loading: newLoading, errors: newErrors };
      });
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to delete object' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // UTILITIES
  // ========================================================================

  getObject: (id: string) => {
    return get().objects[id] || null;
  },

  clearObject: (id: string) => {
    set((state) => {
      const newObjects = { ...state.objects };
      const newLoading = { ...state.loading };
      const newErrors = { ...state.errors };

      delete newObjects[id];
      delete newLoading[id];
      delete newErrors[id];

      return { objects: newObjects, loading: newLoading, errors: newErrors };
    });
  },

  clearAllObjects: () => {
    set({ objects: {}, loading: {}, errors: {} });
  },
}));

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/**
 * Hook to get a single object with automatic loading state
 */
export function useObject(type: ObjectType, id: string | null, language?: string) {
  const store = useUnifiedObjectStore();

  React.useEffect(() => {
    if (id) {
      store.fetchObject(type, id, language);
    }
  }, [type, id, language]);

  if (!id) return { object: null, loading: false, error: null };

  return {
    object: store.objects[id] || null,
    loading: store.loading[id] || false,
    error: store.errors[id] || null,
  };
}

/**
 * Hook to get multiple objects
 */
export function useObjects(type: ObjectType, ids: string[], language?: string) {
  const store = useUnifiedObjectStore();

  React.useEffect(() => {
    ids.forEach((id) => {
      if (!store.objects[id]) {
        store.fetchObject(type, id, language);
      }
    });
  }, [type, ids, language]);

  return {
    objects: ids.map((id) => store.objects[id]).filter(Boolean),
    loading: ids.some((id) => store.loading[id]),
    errors: ids.map((id) => store.errors[id]).filter(Boolean),
  };
}

import React from 'react';
export default useUnifiedObjectStore;
