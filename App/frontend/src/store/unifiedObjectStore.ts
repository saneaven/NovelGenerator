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
  StoryEntityKind,
  OutlineKind,
  StoryEntityObject,
  OutlineObject,
} from '../types/unifiedObject';
import { normalizeBasicInfoData } from '../utils/basicInfo';

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

  // Monotonic counter bumped on every SSE-driven object change
  changeRevision: number;

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
  refreshProjectObjects: (projectId: string, types: ObjectType[]) => Promise<void>;
  createObject: (
    type: ObjectType,
    projectId: string,
    data: any,
    language: string,
    metadata?: Record<string, any>,
    userRequest?: string,
    kind?: StoryEntityKind | OutlineKind
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

  // Bulk sync from SSE object change events
  applyObjectChanges: (params: {
    upserts?: UnifiedObject[];
    deletes?: string[];
  }) => void;
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useUnifiedObjectStore = create<UnifiedObjectStore>((set, get) => {
  return ({
  objects: {},
  loading: {},
  errors: {},
  translating: {},
  changeRevision: 0,

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

  refreshProjectObjects: async (projectId: string, types: ObjectType[]) => {
    if (!projectId || types.length === 0) return;

    const uniqueTypes = [...new Set(types)];
    const responses = await Promise.all(
      uniqueTypes.map(async (type) => ({
        type,
        response: await unifiedObjectService.listObjects(type, projectId, {}),
      })),
    );

    set((state) => {
      const nextObjects = { ...state.objects };
      const refreshedIdsByType = new Map<ObjectType, Set<string>>();

      for (const { type, response } of responses) {
        const ids = new Set<string>();
        for (const obj of response.objects) {
          ids.add(obj.id);
          nextObjects[obj.id] = obj;
        }
        refreshedIdsByType.set(type, ids);
      }

      for (const [objectId, object] of Object.entries(state.objects)) {
        if (!object) continue;
        if (object.metadata?.project_id !== projectId) continue;
        const refreshedIds = refreshedIdsByType.get(object.type);
        if (!refreshedIds) continue;
        if (!refreshedIds.has(objectId)) {
          delete nextObjects[objectId];
        }
      }

      return {
        objects: nextObjects,
      };
    });
  },

  createObject: async (type: ObjectType, projectId: string, data: any, language: string, metadata?: Record<string, any>, userRequest: string = 'User Creation', kind?: StoryEntityKind | OutlineKind) => {
    try {
      const newObject = await unifiedObjectService.createObject(type, projectId, {
        data,
        language,
        kind,
        user_request: userRequest,
        metadata,
      });

      set((state) => ({
        objects: { ...state.objects, [newObject.id]: newObject },
        loading: { ...state.loading, [newObject.id]: false },
      }));

      if (type === 'outline' && kind === 'chapter') {
        const linkedManuscriptId = newObject.metadata?.manuscript_id;
        if (typeof linkedManuscriptId === 'string' && linkedManuscriptId.length > 0) {
          try {
            await get().fetchObject('manuscript', linkedManuscriptId);
          } catch (err) {
            console.error('Failed to sync linked manuscript after chapter creation:', err);
          }
        }
      }
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

  applyObjectChanges: ({ upserts = [], deletes = [] }) => {
    if (!upserts.length && !deletes.length) return;
    set((state) => {
      const nextObjects = { ...state.objects };
      const nextLoading = { ...state.loading };
      const nextErrors = { ...state.errors };
      const nextTranslating = { ...state.translating };

      for (const obj of upserts) {
        nextObjects[obj.id] = obj;
      }
      for (const id of deletes) {
        delete nextObjects[id];
        delete nextLoading[id];
        delete nextErrors[id];
        delete nextTranslating[id];
      }

      return {
        objects: nextObjects,
        loading: nextLoading,
        errors: nextErrors,
        translating: nextTranslating,
        changeRevision: state.changeRevision + 1,
      };
    });
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
 * Simplified project object structure used for chat context.
 * This is a lightweight version without full version history metadata.
 */
export interface SimplifiedProjectObjects {
  basicInfo: {
    id: string;
    title: string;
    logline: string;
    genres: string[];
    tags: string[];
  } | null;
  storyEntities: Array<{ id: string; kind: StoryEntityKind; name: string; description: string; content: string }>;
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
      position: number;
      acts: Array<{
        id: string;
        name: string;
        description: string;
        content: string;
        position: number;
        parentId: string;
        chapters: Array<{
          id: string;
          name: string;
          description: string;
          content: string;
          position: number;
          parentId: string;
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
 * Hook to derive project objects from unified store cache.
 * Extracts data for the specified language from each object.
 *
 * @param projectId - The project ID to filter objects by
 * @param language - The language to extract data for (uses mainLanguage for chat context)
 */
export function useProjectObjects(projectId: string | undefined, language: string): SimplifiedProjectObjects {
  const objects = useUnifiedObjectStore(state => state.objects);

  return React.useMemo(() => {
    if (!projectId) {
      return {
        basicInfo: null,
        storyEntities: [],
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
    const storyEntities = projectObjects
      .filter((obj): obj is StoryEntityObject => obj.type === 'story_entity')
      .sort((a, b) => {
        const orderA = a.metadata.display_order ?? 0;
        const orderB = b.metadata.display_order ?? 0;
        return orderA - orderB;
      });
    const outlineItems = projectObjects.filter((obj): obj is OutlineObject => obj.type === 'outline');
    const outlines = outlineItems.filter((obj): obj is OutlineObject => obj.kind === 'outline');
    const acts = outlineItems.filter((obj): obj is OutlineObject => obj.kind === 'act');
    const chapters = outlineItems.filter((obj): obj is OutlineObject => obj.kind === 'chapter');

    // Build basic info - extract data for language
    const basicInfo = basicInfoList.length > 0 ? (() => {
      const data = normalizeBasicInfoData(getObjectDataForLanguage(basicInfoList[0], language));
      return {
        id: basicInfoList[0].id,
        title: data.title,
        logline: data.logline,
        genres: data.genres,
        tags: data.tags,
      };
    })() : null;

    // Build outline hierarchy: Outline > Acts > Chapters
    const outline = {
      outlines: outlines
        .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0))
        .map(outlineObj => {
          const outlineData = getObjectDataForLanguage(outlineObj, language);
          return {
            id: outlineObj.id,
            name: outlineData.name || '',
            description: outlineData.description || '',
            content: outlineData.content || '',
            position: outlineObj.metadata.position || 0,
            acts: acts
              .filter(act => act.metadata.parent_id === outlineObj.id)
              .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0))
              .map(act => {
                const actData = getObjectDataForLanguage(act, language);
                return {
                  id: act.id,
                  name: actData.name || '',
                  description: actData.description || '',
                  content: actData.content || '',
                  position: act.metadata.position || 0,
                  parentId: act.metadata.parent_id || '',
                  chapters: chapters
                    .filter(ch => ch.metadata.parent_id === act.id)
                    .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0))
                    .map(chapter => {
                      const chapterData = getObjectDataForLanguage(chapter, language);
                      return {
                        id: chapter.id,
                        name: chapterData.name || '',
                        description: chapterData.description || '',
                        content: chapterData.content || '',
                        position: chapter.metadata.position || 0,
                        parentId: chapter.metadata.parent_id || '',
                      };
                    }),
                };
              }),
          };
        }),
    };

    return {
      basicInfo,
      storyEntities: storyEntities.map((entity) => {
        const data = getObjectDataForLanguage(entity, language);
        return {
          id: entity.id,
          kind: entity.kind,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
        };
      }),
      characters: storyEntities
        .filter((entity) => entity.kind === 'character')
        .map((entity) => {
          const data = getObjectDataForLanguage(entity, language);
          return {
            id: entity.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
          };
        }),
      organizations: storyEntities
        .filter((entity) => entity.kind === 'organization')
        .map((entity) => {
          const data = getObjectDataForLanguage(entity, language);
          return {
            id: entity.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
          };
        }),
      locations: storyEntities
        .filter((entity) => entity.kind === 'location')
        .map((entity) => {
          const data = getObjectDataForLanguage(entity, language);
          return {
            id: entity.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
          };
        }),
      lorebook: storyEntities
        .filter((entity) => entity.kind === 'lorebook')
        .map((entity) => {
          const data = getObjectDataForLanguage(entity, language);
          return {
            id: entity.id,
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
