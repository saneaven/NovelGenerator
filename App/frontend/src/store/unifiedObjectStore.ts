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

  // Translation status (reactive, replaces TranslationService static Map)
  translating: Record<string, boolean>;

  // Translation status actions
  setTranslating: (objectId: string, isTranslating: boolean) => void;
  clearTranslating: (objectId: string) => void;

  // CRUD Operations
  fetchObject: (type: ObjectType, id: string, language?: string) => Promise<void>;
  updateObject: (type: ObjectType, id: string, request: UpdateObjectRequest) => Promise<void>;
  addTranslation: (type: ObjectType, id: string, request: AddTranslationRequest) => Promise<void>;

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
  getManuscriptByChapterId: (chapterId: string) => UnifiedObject | null;
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
  translating: {},

  // ========================================================================
  // TRANSLATION STATUS ACTIONS
  // ========================================================================

  setTranslating: (objectId: string, isTranslating: boolean) => {
    set((state) => ({
      translating: { ...state.translating, [objectId]: isTranslating },
    }));
  },

  clearTranslating: (objectId: string) => {
    set((state) => {
      const newTranslating = { ...state.translating };
      delete newTranslating[objectId];
      return { translating: newTranslating };
    });
  },

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

  /**
   * Find manuscript object by chapter_id
   * Returns the manuscript object or null if not found
   */
  getManuscriptByChapterId: (chapterId: string) => {
    const objects = get().objects;
    const manuscript = Object.values(objects).find(
      obj => obj.type === 'manuscript' && obj.metadata?.chapter_id === chapterId
    );
    return manuscript || null;
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
    set({ objects: {}, loading: {}, errors: {}, translating: {} });
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

// ============================================================================
// STORY OBJECTS HOOK - Reactive derivation from store
// ============================================================================

/**
 * Hook to derive StoryObjects from unified store cache.
 * Automatically updates when any object in the store changes.
 */
/**
 * Simplified story objects structure used for chat context.
 * This is a lightweight version without full version history metadata.
 */
export interface SimplifiedStoryObjects {
  basicInfo: {
    id: string;
    title: string;
    logline: string;
    genre: string;
  } | null;
  characters: Array<{ id: string; name: string; description: string }>;
  organizations: Array<{ id: string; name: string; description: string }>;
  locations: Array<{ id: string; name: string; description: string }>;
  lorebook: Array<{ id: string; name: string; description: string }>;
  outline: {
    acts: Array<{
      id: string;
      name: string;
      description: string;
      order: number;
      chapters: Array<{
        id: string;
        name: string;
        description: string;
        order: number;
        actId: string;
      }>;
    }>;
  };
}

export function useStoryObjects(projectId: string | undefined): SimplifiedStoryObjects {
  const objects = useUnifiedObjectStore(state => state.objects);

  return React.useMemo(() => {
    if (!projectId) {
      return {
        basicInfo: null,
        characters: [],
        organizations: [],
        locations: [],
        lorebook: [],
        outline: { acts: [] },
      };
    }

    // Get all objects as array and filter by projectId
    const allObjects = Object.values(objects);
    const projectObjects = allObjects.filter(
      obj => obj.metadata?.project_id === projectId
    );

    // Group by type
    const basicInfoList = projectObjects.filter(obj => obj.type === 'basic_info');
    const characters = projectObjects.filter(obj => obj.type === 'character');
    const organizations = projectObjects.filter(obj => obj.type === 'organization');
    const locations = projectObjects.filter(obj => obj.type === 'location');
    const lorebook = projectObjects.filter(obj => obj.type === 'lorebook');
    const acts = projectObjects.filter(obj => obj.type === 'act');
    const chapters = projectObjects.filter(obj => obj.type === 'chapter');

    // Build basic info
    const basicInfo = basicInfoList.length > 0 ? {
      id: basicInfoList[0].id,
      title: basicInfoList[0].data.title || '',
      logline: basicInfoList[0].data.logline || '',
      genre: basicInfoList[0].data.genre || '',
    } : null;

    // Build outline with acts and chapters
    const outline = {
      acts: acts
        .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
        .map(act => ({
          id: act.id,
          name: act.data.name || '',
          description: act.data.description || '',
          order: act.metadata.order || 0,
          chapters: chapters
            .filter(ch => ch.metadata.act_id === act.id)
            .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
            .map(chapter => ({
              id: chapter.id,
              name: chapter.data.name || '',
              description: chapter.data.description || '',
              order: chapter.metadata.order || 0,
              actId: chapter.metadata.act_id || '',
            })),
        })),
    };

    return {
      basicInfo,
      characters: characters.map(ch => ({
        id: ch.id,
        name: ch.data.name || '',
        description: ch.data.description || '',
      })),
      organizations: organizations.map(org => ({
        id: org.id,
        name: org.data.name || '',
        description: org.data.description || '',
      })),
      locations: locations.map(loc => ({
        id: loc.id,
        name: loc.data.name || '',
        description: loc.data.description || '',
      })),
      lorebook: lorebook.map(entry => ({
        id: entry.id,
        name: entry.data.name || '',
        description: entry.data.description || '',
      })),
      outline,
    };
  }, [objects, projectId]);
}

export default useUnifiedObjectStore;
