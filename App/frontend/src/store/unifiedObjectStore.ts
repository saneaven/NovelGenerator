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
import { ragService } from '../api/ragService';
import { useCredentialsStore } from './credentialsStore';
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
  // Single object storage by ID - contains ALL languages per object
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
  restoreVersion: (type: ObjectType, id: string, versionId: string) => Promise<void>;

  // Translation management
  deleteTranslation: (type: ObjectType, id: string, language: string) => Promise<void>;

  // List & Collection operations
  listObjects: (type: ObjectType, projectId: string) => Promise<UnifiedObject[]>;
  createObject: (
    type: ObjectType,
    projectId: string,
    data: any,
    language: string,
    metadata?: Record<string, any>,
    userRequest?: string
  ) => Promise<UnifiedObject>;
  deleteObject: (type: ObjectType, id: string) => Promise<void>;

  // Utilities
  getObject: (id: string) => UnifiedObject | null;
  getManuscriptByChapterId: (chapterId: string) => UnifiedObject | null;
  clearObject: (id: string) => void;
  clearAllObjects: () => void;

  // Language checking utilities
  getObjectsMissingMainLanguage: (projectId: string, mainLanguage: string) => UnifiedObject[];

  // Image prompt management
  updateImagePrompt: (
    type: ObjectType,
    id: string,
    prompts: {
      image_prompt?: string;
      image_prompt_positive?: string;
      image_prompt_negative?: string;
    }
  ) => Promise<void>;

  // Reordering
  reorderObjects: (
    type: ObjectType,
    projectId: string,
    objectIds: string[]
  ) => Promise<void>;
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useUnifiedObjectStore = create<UnifiedObjectStore>((set, get) => {
  let cachedRagProfile: any | null | undefined = undefined;
  let cachedRagProfileAt = 0;
  let cachedRagProfilePromise: Promise<any | null> | null = null;

  const getRagProfileCached = async (): Promise<any | null> => {
    const now = Date.now();
    if (cachedRagProfile !== undefined && now - cachedRagProfileAt < 10_000) {
      return cachedRagProfile;
    }

    if (!cachedRagProfilePromise) {
      cachedRagProfilePromise = ragService
        .getProfile()
        .catch(() => null)
        .finally(() => {
          cachedRagProfilePromise = null;
        });
    }

    cachedRagProfile = await cachedRagProfilePromise;
    cachedRagProfileAt = Date.now();
    return cachedRagProfile;
  };

  const buildProviderConfig = (provider: string, creds: any): any | null => {
    const config: any = {};

    if (provider === 'custom') {
      config.api_key = creds.custom?.apiKey || undefined;
      config.base_url = creds.custom?.baseUrl || undefined;
    } else {
      config.api_key = creds?.[provider]?.apiKey || undefined;
    }

    if (!config.api_key) return null;
    if (provider === 'custom' && !config.base_url) return null;
    return config;
  };

  const scheduleRagIndex = async (args: {
    projectId: string | undefined;
    objectType: ObjectType;
    objectId: string;
  }): Promise<void> => {
    const { projectId, objectType, objectId } = args;
    if (!projectId) return;

    const profile = await getRagProfileCached();
    if (!profile?.provider || !profile?.model) return;

    const creds = useCredentialsStore.getState().credentials as any;
    const config = buildProviderConfig(profile.provider, creds);
    if (!config) return;

    try {
      await ragService.indexObject(projectId, { object_type: objectType, object_id: objectId, config });
    } catch (err) {
      console.debug('RAG index failed:', err);
    }
  };

  const scheduleRagDelete = async (args: {
    projectId: string | undefined;
    objectType: ObjectType;
    objectId: string;
  }): Promise<void> => {
    const { projectId, objectType, objectId } = args;
    if (!projectId) return;

    try {
      await ragService.deleteObject(projectId, { object_type: objectType, object_id: objectId });
    } catch (err) {
      console.debug('RAG delete failed:', err);
    }
  };

  return ({
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
      // Fetch object (optionally for a specific language)
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

      const projectId = updatedObject.metadata?.project_id || get().objects[id]?.metadata?.project_id;
      void scheduleRagIndex({ projectId, objectType: type, objectId: id });
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

      // Refetch object to get updated data with all languages
      await get().fetchObject(type, id);

      const obj = get().objects[id];
      const projectId = obj?.metadata?.project_id;
      void scheduleRagIndex({ projectId, objectType: type, objectId: id });
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

  restoreVersion: async (type: ObjectType, id: string, versionId: string) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.restoreVersion(type, id, versionId);

      // Refetch object to get updated data with all languages
      await get().fetchObject(type, id);

      const obj = get().objects[id];
      const projectId = obj?.metadata?.project_id;
      void scheduleRagIndex({ projectId, objectType: type, objectId: id });
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to restore version' },
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

      // Refetch object to get updated data with all languages
      await get().fetchObject(type, id);

      const obj = get().objects[id];
      const projectId = obj?.metadata?.project_id;
      void scheduleRagIndex({ projectId, objectType: type, objectId: id });
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

  listObjects: async (type: ObjectType, projectId: string) => {
    try {
      // Check if we already have objects of this type for this project in cache
      const state = get();
      const cachedObjects = Object.values(state.objects).filter(
        obj => obj.type === type && obj.metadata?.project_id === projectId
      );

      // If we have cached data, return it without making API call
      if (cachedObjects.length > 0) {
        return cachedObjects;
      }

      // Fetch all languages (no language param = returns all languages)
      const response = await unifiedObjectService.listObjects(type, projectId, {});

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

  createObject: async (type: ObjectType, projectId: string, data: any, language: string, metadata?: Record<string, any>, userRequest: string = 'User Creation') => {
    try {
      const newObject = await unifiedObjectService.createObject(type, projectId, {
        data,
        language,
        user_request: userRequest,
        metadata,
      });

      set((state) => ({
        objects: { ...state.objects, [newObject.id]: newObject },
        loading: { ...state.loading, [newObject.id]: false },
      }));

      void scheduleRagIndex({ projectId, objectType: type, objectId: newObject.id });
      return newObject;
    } catch (error: any) {
      console.error('Failed to create object:', error);
      throw error;
    }
  },

  deleteObject: async (type: ObjectType, id: string) => {
    const projectId = get().objects[id]?.metadata?.project_id;
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      await unifiedObjectService.deleteObject(type, id);

      // Remove object from cache
      set((state) => {
        const newObjects = { ...state.objects };
        const newLoading = { ...state.loading };
        const newErrors = { ...state.errors };

        delete newObjects[id];
        delete newLoading[id];
        delete newErrors[id];

        return { objects: newObjects, loading: newLoading, errors: newErrors };
      });

      void scheduleRagDelete({ projectId, objectType: type, objectId: id });
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

  // ========================================================================
  // LANGUAGE CHECKING UTILITIES
  // ========================================================================

  getObjectsMissingMainLanguage: (projectId: string, mainLanguage: string) => {
    const objects = get().objects;
    const missing: UnifiedObject[] = [];

    Object.values(objects).forEach(obj => {
      // Only check objects for this project
      if (obj.metadata?.project_id !== projectId) return;

      // Skip manuscript type (they're handled separately in NovelEditor)
      if (obj.type === 'manuscript') return;

      // Check if main language is NOT in available languages (Object.keys(data))
      const availableLanguages = Object.keys(obj.data || {});
      if (!availableLanguages.includes(mainLanguage)) {
        missing.push(obj);
      }
    });

    return missing;
  },

  // ========================================================================
  // IMAGE PROMPT MANAGEMENT
  // ========================================================================

  updateImagePrompt: async (
    type: ObjectType,
    id: string,
    prompts: {
      image_prompt?: string;
      image_prompt_positive?: string;
      image_prompt_negative?: string;
    }
  ) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      const result = await unifiedObjectService.updateImagePrompt(type, id, prompts);

      // Update the object in the store with the new image prompts
      set((state) => {
        const existingObject = state.objects[id];
        if (existingObject) {
          return {
            objects: {
              ...state.objects,
              [id]: {
                ...existingObject,
                metadata: {
                  ...existingObject.metadata,
                  image_prompt: result.image_prompt,
                  image_prompt_positive: result.image_prompt_positive,
                  image_prompt_negative: result.image_prompt_negative,
                },
              },
            },
            loading: { ...state.loading, [id]: false },
          };
        }
        return { loading: { ...state.loading, [id]: false } };
      });
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to update image prompt' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  // ========================================================================
  // REORDERING
  // ========================================================================

  reorderObjects: async (type: ObjectType, projectId: string, objectIds: string[]) => {
    // Save old state for rollback
    const oldObjects = { ...get().objects };

    // Optimistic update - update local state IMMEDIATELY
    set((state) => {
      const newObjects = { ...state.objects };
      objectIds.forEach((id, index) => {
        if (newObjects[id]) {
          newObjects[id] = {
            ...newObjects[id],
            metadata: {
              ...newObjects[id].metadata,
              order: index + 1,
            },
          };
        }
      });
      return { objects: newObjects };
    });

    // Then call API (if fails, rollback)
    try {
      await unifiedObjectService.reorderObjects(type, projectId, objectIds);
      for (const objectId of objectIds) {
        void scheduleRagIndex({ projectId, objectType: type, objectId });
      }
    } catch (error: any) {
      // Rollback on error
      set({ objects: oldObjects });
      console.error('Failed to reorder objects:', error);
      throw error;
    }
  },
  });
});

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

import React from 'react';

/**
 * Hook to get a single object with automatic loading state
 */
export function useObject(type: ObjectType, id: string | null) {
  const store = useUnifiedObjectStore();

  React.useEffect(() => {
    if (id) {
      store.fetchObject(type, id);
    }
  }, [type, id]);

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
export function useObjects(type: ObjectType, ids: string[]) {
  const store = useUnifiedObjectStore();

  React.useEffect(() => {
    ids.forEach((id) => {
      if (!store.objects[id]) {
        store.fetchObject(type, id);
      }
    });
  }, [type, ids]);

  return {
    objects: ids.map((id) => store.objects[id]).filter(Boolean),
    loading: ids.some((id) => store.loading[id]),
    errors: ids.map((id) => store.errors[id]).filter(Boolean),
  };
}

// ============================================================================
// STORY OBJECTS HOOK - Reactive derivation from store
// ============================================================================

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
  characters: Array<{ id: string; name: string; description: string; content: string }>;
  organizations: Array<{ id: string; name: string; description: string; content: string }>;
  locations: Array<{ id: string; name: string; description: string; content: string }>;
  lorebook: Array<{ id: string; name: string; description: string; content: string }>;
  outline: {
    outlines: Array<{
      id: string;
      name: string;
      description: string;
      content: string;
      order: number;
      acts: Array<{
        id: string;
        name: string;
        description: string;
        content: string;
        order: number;
        outlineId: string;
        chapters: Array<{
          id: string;
          name: string;
          description: string;
          content: string;
          order: number;
          actId: string;
        }>;
      }>;
    }>;
  };
}

/**
 * Helper to get data for a specific language from an object.
 * Falls back to first available language if requested language not found.
 */
function getObjectDataForLanguage(obj: UnifiedObject, language: string): Record<string, any> {
  // Try requested language first
  if (obj.data[language]) {
    return obj.data[language];
  }
  // Fallback to first available language
  const availableLanguages = Object.keys(obj.data);
  if (availableLanguages.length > 0) {
    return obj.data[availableLanguages[0]];
  }
  return {};
}

/**
 * Hook to derive StoryObjects from unified store cache.
 * Extracts data for the specified language from each object.
 *
 * @param projectId - The project ID to filter objects by
 * @param language - The language to extract data for (uses mainLanguage for chat context)
 */
export function useStoryObjects(projectId: string | undefined, language: string): SimplifiedStoryObjects {
  const objects = useUnifiedObjectStore(state => state.objects);

  return React.useMemo(() => {
    if (!projectId) {
      return {
        basicInfo: null,
        characters: [],
        organizations: [],
        locations: [],
        lorebook: [],
        outline: { outlines: [] },
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
    const outlines = projectObjects.filter(obj => obj.type === 'outline');
    const acts = projectObjects.filter(obj => obj.type === 'act');
    const chapters = projectObjects.filter(obj => obj.type === 'chapter');

    // Build basic info - extract data for language
    const basicInfo = basicInfoList.length > 0 ? (() => {
      const data = getObjectDataForLanguage(basicInfoList[0], language);
      return {
        id: basicInfoList[0].id,
        title: data.title || '',
        logline: data.logline || '',
        genre: data.genre || '',
      };
    })() : null;

    // Build outline hierarchy: Outline > Acts > Chapters
    const outline = {
      outlines: outlines
        .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
        .map(outlineObj => {
          const outlineData = getObjectDataForLanguage(outlineObj, language);
          return {
            id: outlineObj.id,
            name: outlineData.name || '',
            description: outlineData.description || '',
            content: outlineData.content || '',
            order: outlineObj.metadata.order || 0,
            acts: acts
              .filter(act => act.metadata.outline_id === outlineObj.id)
              .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
              .map(act => {
                const actData = getObjectDataForLanguage(act, language);
                return {
                  id: act.id,
                  name: actData.name || '',
                  description: actData.description || '',
                  content: actData.content || '',
                  order: act.metadata.order || 0,
                  outlineId: act.metadata.outline_id || '',
                  chapters: chapters
                    .filter(ch => ch.metadata.act_id === act.id)
                    .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                    .map(chapter => {
                      const chapterData = getObjectDataForLanguage(chapter, language);
                      return {
                        id: chapter.id,
                        name: chapterData.name || '',
                        description: chapterData.description || '',
                        content: chapterData.content || '',
                        order: chapter.metadata.order || 0,
                        actId: chapter.metadata.act_id || '',
                      };
                    }),
                };
              }),
          };
        }),
    };

    return {
      basicInfo,
      characters: characters.map(ch => {
        const data = getObjectDataForLanguage(ch, language);
        return {
          id: ch.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
        };
      }),
      organizations: organizations.map(org => {
        const data = getObjectDataForLanguage(org, language);
        return {
          id: org.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
        };
      }),
      locations: locations.map(loc => {
        const data = getObjectDataForLanguage(loc, language);
        return {
          id: loc.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
        };
      }),
      lorebook: lorebook.map(entry => {
        const data = getObjectDataForLanguage(entry, language);
        return {
          id: entry.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
        };
      }),
      outline,
    };
  }, [objects, projectId, language]);
}

export default useUnifiedObjectStore;
