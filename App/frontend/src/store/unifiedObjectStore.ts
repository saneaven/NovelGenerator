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
  StoryEntityStructureObjectType,
} from '../types/unifiedObject';
import { normalizeBasicInfoData } from '../utils/basicInfo';
import { collectStoryEntitySubtreeIds } from '../utils/storyEntityTree';
import { sortOutlineObjects } from '../utils/outlineOrdering';
import type { TipTapDoc } from '../types/tiptap';
import { normalizeDoc } from '../editor/manuscript/doc';

const STORY_ENTITY_TREE_TYPES: ObjectType[] = ['story_entity_folder', 'story_entity'];
const STORY_ENTITY_TREE_HYDRATION_KEY = '__story_entity_tree__';
const OUTLINE_COLLECTION_PAGE_SIZE = 100;
type RichFieldName = 'content' | 'authorNote';
type MarkdownPreviewCache = Record<
  string,
  Record<string, Partial<Record<RichFieldName, string>>>
>;

const defaultRichTextFormatForType = (type: ObjectType): 'tiptap' | 'markdown' => (
  type === 'guidelines'
  || type === 'story_entity'
  || type === 'outline'
  || type === 'manuscript'
  || type === 'timeline_track'
  || type === 'timeline_event'
    ? 'tiptap'
    : 'markdown'
);

const RICH_PREVIEW_FIELDS: Partial<Record<ObjectType, readonly RichFieldName[]>> = {
  guidelines: ['authorNote'],
  story_entity: ['content'],
  outline: ['content'],
  manuscript: ['content'],
  timeline_track: ['content'],
  timeline_event: ['content'],
};

type ProjectHydrationKey = string;
type ProjectHydrationState = Partial<Record<ProjectHydrationKey, boolean>>;
type ProjectionObjectCache = Record<string, Record<string, UnifiedObject>>;

const collectionRequestInflight = new Map<string, Promise<void>>();
const outlineCollectionRevision = new Map<string, number>();

function isStoryEntityTreeType(type: ObjectType): type is StoryEntityStructureObjectType {
  return type === 'story_entity_folder' || type === 'story_entity';
}

function getProjectHydration(
  projectHydration: Record<string, ProjectHydrationState>,
  projectId: string,
): ProjectHydrationState {
  return projectHydration[projectId] ?? {};
}

function isProjectHydrated(
  projectHydration: Record<string, ProjectHydrationState>,
  projectId: string,
  key: ProjectHydrationKey,
): boolean {
  return Boolean(getProjectHydration(projectHydration, projectId)[key]);
}

function setProjectHydrationState(
  projectHydration: Record<string, ProjectHydrationState>,
  projectId: string,
  keys: ProjectHydrationKey[],
  hydrated: boolean,
): Record<string, ProjectHydrationState> {
  const currentProjectHydration = getProjectHydration(projectHydration, projectId);
  const nextProjectHydration: ProjectHydrationState = { ...currentProjectHydration };
  let changed = false;

  for (const key of keys) {
    if (hydrated) {
      if (!nextProjectHydration[key]) {
        nextProjectHydration[key] = true;
        changed = true;
      }
      continue;
    }

    if (nextProjectHydration[key]) {
      delete nextProjectHydration[key];
      changed = true;
    }
  }

  if (!changed) {
    return projectHydration;
  }

  if (Object.keys(nextProjectHydration).length === 0) {
    const nextProjectHydrationByProject = { ...projectHydration };
    delete nextProjectHydrationByProject[projectId];
    return nextProjectHydrationByProject;
  }

  return {
    ...projectHydration,
    [projectId]: nextProjectHydration,
  };
}

function getCollectionRequestKey(projectId: string, key: ProjectHydrationKey): string {
  return `${projectId}:${key}`;
}

function collectionHydrationKey(type: ObjectType, language?: string): ProjectHydrationKey {
  return `${type}:${language || '__default__'}`;
}

function storyTreeHydrationKey(language?: string): ProjectHydrationKey {
  return `${STORY_ENTITY_TREE_HYDRATION_KEY}:${language || '__default__'}`;
}

function projectionCacheKey(projectId: string, language?: string): string {
  return `${projectId}:${language || '__default__'}`;
}

function mergeProjectionCache(
  currentCache: ProjectionObjectCache,
  projectId: string,
  language: string | undefined,
  objects: UnifiedObject[],
  types: ObjectType[],
): ProjectionObjectCache {
  const key = projectionCacheKey(projectId, language);
  return {
    ...currentCache,
    [key]: reconcileProjectObjects(currentCache[key] ?? {}, projectId, objects, types),
  };
}

function upsertProjectionObject(
  currentCache: ProjectionObjectCache,
  object: UnifiedObject,
  language?: string,
): ProjectionObjectCache {
  const projectId = object.metadata?.project_id;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return currentCache;
  }
  const key = projectionCacheKey(projectId, language || object.language_state?.requested_language);
  return {
    ...currentCache,
    [key]: {
      ...(currentCache[key] ?? {}),
      [object.id]: object,
    },
  };
}

function deleteProjectionObject(
  currentCache: ProjectionObjectCache,
  objectId: string,
): ProjectionObjectCache {
  let nextCache = currentCache;
  let changed = false;
  for (const [key, objects] of Object.entries(currentCache)) {
    if (!(objectId in objects)) continue;
    if (!changed) {
      nextCache = { ...currentCache };
      changed = true;
    }
    const nextObjects = { ...objects };
    delete nextObjects[objectId];
    nextCache[key] = nextObjects;
  }
  return nextCache;
}

function reconcileProjectObjects(
  currentObjects: Record<string, UnifiedObject>,
  projectId: string,
  objects: UnifiedObject[],
  types: ObjectType[],
): Record<string, UnifiedObject> {
  const nextObjects = { ...currentObjects };
  const refreshedIdsByType = new Map<ObjectType, Set<string>>();

  for (const type of types) {
    refreshedIdsByType.set(type, new Set<string>());
  }

  for (const object of objects) {
    nextObjects[object.id] = object;
    const ids = refreshedIdsByType.get(object.type) ?? new Set<string>();
    ids.add(object.id);
    refreshedIdsByType.set(object.type, ids);
  }

  for (const [objectId, object] of Object.entries(currentObjects)) {
    if (!object || object.metadata?.project_id !== projectId) continue;
    const refreshedIds = refreshedIdsByType.get(object.type);
    if (!refreshedIds) continue;
    if (!refreshedIds.has(objectId)) {
      delete nextObjects[objectId];
    }
  }

  return nextObjects;
}

export function isRichPreviewType(type: ObjectType): boolean {
  return Boolean(RICH_PREVIEW_FIELDS[type]);
}

function mergeMarkdownPreviewFromObject(
  currentPreviews: MarkdownPreviewCache,
  object: UnifiedObject,
): MarkdownPreviewCache {
  const fields = RICH_PREVIEW_FIELDS[object.type];
  if (!fields) return currentPreviews;

  let nextPreviews = currentPreviews;
  const existingObjectPreview = currentPreviews[object.id] ?? {};
  let nextObjectPreview = existingObjectPreview;
  let objectChanged = false;
  const requestedLanguage = object.language_state?.requested_language;
  const values = requestedLanguage
    ? [[requestedLanguage, object.data] as const]
    : [['__default__', object.data] as const];

  for (const [language, value] of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const existingLanguagePreview = existingObjectPreview[language] ?? {};
    let nextLanguagePreview = existingLanguagePreview;
    let languageChanged = false;

    for (const field of fields) {
      const previewValue = (value as Record<string, unknown>)[field];
      if (typeof previewValue !== 'string') continue;
      if (existingLanguagePreview[field] === previewValue) continue;
      if (!languageChanged) {
        nextLanguagePreview = { ...existingLanguagePreview };
        languageChanged = true;
      }
      nextLanguagePreview[field] = previewValue;
    }

    if (languageChanged) {
      if (!objectChanged) {
        nextObjectPreview = { ...existingObjectPreview };
        objectChanged = true;
      }
      nextObjectPreview[language] = nextLanguagePreview;
    }
  }

  if (!objectChanged) return currentPreviews;
  if (nextPreviews === currentPreviews) {
    nextPreviews = { ...currentPreviews };
  }
  nextPreviews[object.id] = nextObjectPreview;
  return nextPreviews;
}

function mergeMarkdownPreviewFromObjects(
  currentPreviews: MarkdownPreviewCache,
  objects: UnifiedObject[],
): MarkdownPreviewCache {
  let nextPreviews = currentPreviews;
  for (const object of objects) {
    nextPreviews = mergeMarkdownPreviewFromObject(nextPreviews, object);
  }
  return nextPreviews;
}

function getRichTextMarkdownFromCache(
  previews: MarkdownPreviewCache,
  objectId: string,
  language: string,
  fieldName: RichFieldName,
): string | undefined {
  const objectPreview = previews[objectId];
  if (!objectPreview) return undefined;
  const exact = objectPreview[language]?.[fieldName];
  if (typeof exact === 'string') return exact;
  return undefined;
}

function removeMarkdownPreview(
  currentPreviews: MarkdownPreviewCache,
  objectId: string,
): MarkdownPreviewCache {
  if (!(objectId in currentPreviews)) return currentPreviews;
  const nextPreviews = { ...currentPreviews };
  delete nextPreviews[objectId];
  return nextPreviews;
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface UnifiedObjectStore {
  // Single object storage by ID - contains the currently requested language projection.
  objects: Record<string, UnifiedObject>;
  objectsByLanguage: ProjectionObjectCache;
  projectHydration: Record<string, ProjectHydrationState>;
  markdownPreviews: MarkdownPreviewCache;
  previewHydration: Record<string, ProjectHydrationState>;

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
  getVersions: (
    type: ObjectType,
    id: string,
    options?: { includeContent?: boolean },
  ) => Promise<VersionHistoryEntry[]>;
  getVersion: (type: ObjectType, id: string, versionId: string) => Promise<VersionHistoryEntry>;
  restoreVersion: (type: ObjectType, id: string, versionId: string) => Promise<void>;

  // Translation management
  deleteTranslation: (type: ObjectType, id: string, language: string) => Promise<void>;

  // List & Collection operations
  listObjects: (type: ObjectType, projectId: string, language?: string) => Promise<UnifiedObject[]>;
  refreshProjectObjects: (projectId: string, types: ObjectType[], language?: string) => Promise<void>;
  refreshStoryEntityTree: (
    projectId: string,
    options?: { force?: boolean; language?: string },
  ) => Promise<void>;
  createObject: (
    type: ObjectType,
    projectId: string,
    data: any,
    language: string,
    metadata?: Record<string, any>,
    userRequest?: string,
    kind?: StoryEntityKind | OutlineKind
  ) => Promise<UnifiedObject>;
  patchObjectStructure: (
    type: StoryEntityStructureObjectType,
    id: string,
    metadata: Record<string, any>,
  ) => Promise<void>;
  deleteObject: (type: ObjectType, id: string) => Promise<void>;

  // Utilities
  getObject: (id: string) => UnifiedObject | null;
  getObjectsForProject: (projectId: string, language?: string) => Record<string, UnifiedObject>;
  getManuscriptByChapterId: (chapterId: string) => UnifiedObject | null;
  getRichTextMarkdown: (objectId: string, language: string, fieldName: RichFieldName) => string | undefined;
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
    markdownUpserts?: UnifiedObject[];
    deletes?: string[];
  }) => void;
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useUnifiedObjectStore = create<UnifiedObjectStore>((set, get) => {
  const getProjectObjectsByType = (
    projectId: string,
    type: ObjectType,
    objects: Record<string, UnifiedObject> = get().objects,
  ): UnifiedObject[] => (
    Object.values(objects).filter(
      (object) => object.type === type && object.metadata?.project_id === projectId,
    )
  );

  const withCollectionRequestDeduped = async (
    projectId: string,
    key: ProjectHydrationKey,
    run: () => Promise<void>,
  ): Promise<void> => {
    const requestKey = getCollectionRequestKey(projectId, key);
    const existing = collectionRequestInflight.get(requestKey);
    if (existing) {
      await existing;
      return;
    }

    const request = run().finally(() => {
      // Keep the resolved promise in the map for a short grace period so that
      // rapid SSE-driven invalidations don't trigger immediate re-fetches.
      setTimeout(() => {
        if (collectionRequestInflight.get(requestKey) === request) {
          collectionRequestInflight.delete(requestKey);
        }
      }, 500);
    });
    collectionRequestInflight.set(requestKey, request);
    await request;
  };

  const isOutlineStructureMetadata = (metadata?: Record<string, unknown>): boolean => {
    if (!metadata) return false;
    return 'position' in metadata || 'parent_id' in metadata;
  };

  const fetchAllOutlinePages = async (projectId: string, language?: string): Promise<UnifiedObject[]> => {
    const outlineObjects: UnifiedObject[] = [];
    let page = 1;
    let total = 0;

    do {
      const response = await unifiedObjectService.listObjects('outline', projectId, {
        language,
        rich_text_format: 'tiptap',
        page,
        page_size: OUTLINE_COLLECTION_PAGE_SIZE,
      });
      total = response.total;
      outlineObjects.push(...response.objects);
      page += 1;
    } while (outlineObjects.length < total);

    return outlineObjects;
  };

  const fetchAllOutlineMarkdownPages = async (projectId: string, language?: string): Promise<UnifiedObject[]> => {
    const outlineObjects: UnifiedObject[] = [];
    let page = 1;
    let total = 0;

    do {
      const response = await unifiedObjectService.listObjects('outline', projectId, {
        language,
        rich_text_format: 'markdown',
        page,
        page_size: OUTLINE_COLLECTION_PAGE_SIZE,
      });
      total = response.total;
      outlineObjects.push(...response.objects);
      page += 1;
    } while (outlineObjects.length < total);

    return outlineObjects;
  };

  const reloadOutlineObjects = async (projectId: string, language?: string): Promise<UnifiedObject[]> => {
    if (!projectId) return [];

    const nextRevision = (outlineCollectionRevision.get(projectId) ?? 0) + 1;
    outlineCollectionRevision.set(projectId, nextRevision);

    const [outlineObjects, markdownOutlineObjects] = await Promise.all([
      fetchAllOutlinePages(projectId, language),
      fetchAllOutlineMarkdownPages(projectId, language),
    ]);
    if ((outlineCollectionRevision.get(projectId) ?? 0) !== nextRevision) {
      return getProjectObjectsByType(
        projectId,
        'outline',
        get().objectsByLanguage[projectionCacheKey(projectId, language)] ?? get().objects,
      );
    }

    set((currentState) => ({
      objects: reconcileProjectObjects(currentState.objects, projectId, outlineObjects, ['outline']),
      objectsByLanguage: mergeProjectionCache(
        currentState.objectsByLanguage,
        projectId,
        language,
        outlineObjects,
        ['outline'],
      ),
      markdownPreviews: mergeMarkdownPreviewFromObjects(currentState.markdownPreviews, markdownOutlineObjects),
      projectHydration: setProjectHydrationState(
        currentState.projectHydration,
        projectId,
        [collectionHydrationKey('outline', language)],
        true,
      ),
      previewHydration: setProjectHydrationState(
        currentState.previewHydration,
        projectId,
        [collectionHydrationKey('outline', language)],
        true,
      ),
    }));

    return outlineObjects;
  };

  return ({
  objects: {},
  objectsByLanguage: {},
  projectHydration: {},
  markdownPreviews: {},
  previewHydration: {},
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
      const richPreviewType = isRichPreviewType(type);
      const [object, markdownObject] = await Promise.all([
        unifiedObjectService.getObject(
          type,
          id,
          language,
          defaultRichTextFormatForType(type),
        ),
        richPreviewType
          ? unifiedObjectService.getObject(type, id, language, 'markdown')
          : Promise.resolve(null),
      ]);

      set((state) => ({
        objects: { ...state.objects, [id]: object },
        objectsByLanguage: upsertProjectionObject(state.objectsByLanguage, object, language),
        markdownPreviews: markdownObject
          ? mergeMarkdownPreviewFromObject(state.markdownPreviews, markdownObject)
          : state.markdownPreviews,
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
      const updatedObject = await unifiedObjectService.updateObject(type, id, {
        ...request,
        rich_text_format: request.rich_text_format ?? defaultRichTextFormatForType(type),
      });
      const markdownObject = isRichPreviewType(type)
        ? await unifiedObjectService.getObject(type, id, request.language, 'markdown')
        : null;
      const outlineProjectId = type === 'outline' ? updatedObject.metadata?.project_id : undefined;
      const shouldReloadOutlineCollection = (
        type === 'outline'
        && isOutlineStructureMetadata(request.metadata as Record<string, unknown> | undefined)
        && typeof outlineProjectId === 'string'
      );

      set((state) => ({
        objects: { ...state.objects, [id]: updatedObject },
        objectsByLanguage: upsertProjectionObject(state.objectsByLanguage, updatedObject, request.language),
        markdownPreviews: markdownObject
          ? mergeMarkdownPreviewFromObject(state.markdownPreviews, markdownObject)
          : state.markdownPreviews,
        loading: { ...state.loading, [id]: false },
        projectHydration: shouldReloadOutlineCollection
          ? setProjectHydrationState(
            state.projectHydration,
            outlineProjectId,
            ['outline'],
            false,
          )
          : state.projectHydration,
      }));

      if (shouldReloadOutlineCollection) {
        await reloadOutlineObjects(outlineProjectId);
      }
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
      await unifiedObjectService.addTranslation(type, id, {
        ...request,
        rich_text_format: request.rich_text_format ?? defaultRichTextFormatForType(type),
      });

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

  getVersions: async (
    type: ObjectType,
    id: string,
    options?: { includeContent?: boolean },
  ) => {
    try {
      const versions = await unifiedObjectService.getVersions(type, id, options);
      return versions;
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to fetch versions' },
      }));
      throw error;
    }
  },

  getVersion: async (type: ObjectType, id: string, versionId: string) => {
    try {
      return await unifiedObjectService.getVersion(type, id, versionId);
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to fetch version' },
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
      await unifiedObjectService.restoreVersion(type, id, versionId, defaultRichTextFormatForType(type));

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

  listObjects: async (type: ObjectType, projectId: string, language?: string) => {
    try {
      if (!projectId) {
        return [];
      }

      const hydrationKey = collectionHydrationKey(type, language);
      if (type === 'outline') {
        const state = get();
        if (isProjectHydrated(state.projectHydration, projectId, hydrationKey)) {
          return getProjectObjectsByType(
            projectId,
            type,
            state.objectsByLanguage[projectionCacheKey(projectId, language)] ?? state.objects,
          );
        }
        return await reloadOutlineObjects(projectId, language);
      }

      if (isStoryEntityTreeType(type)) {
        await get().refreshStoryEntityTree(projectId, { language });
        return getProjectObjectsByType(projectId, type);
      }

      const state = get();
      const previewReady = !isRichPreviewType(type) || isProjectHydrated(state.previewHydration, projectId, hydrationKey);
      if (isProjectHydrated(state.projectHydration, projectId, hydrationKey) && previewReady) {
        return getProjectObjectsByType(
          projectId,
          type,
          state.objectsByLanguage[projectionCacheKey(projectId, language)] ?? state.objects,
        );
      }

      await withCollectionRequestDeduped(projectId, hydrationKey, async () => {
        const richPreviewType = isRichPreviewType(type);
        const [response, markdownResponse] = await Promise.all([
          unifiedObjectService.listObjects(type, projectId, {
            language,
            rich_text_format: defaultRichTextFormatForType(type),
          }),
          richPreviewType
            ? unifiedObjectService.listObjects(type, projectId, {
              language,
              rich_text_format: 'markdown',
            })
            : Promise.resolve(null),
        ]);
        set((currentState) => ({
          objects: reconcileProjectObjects(currentState.objects, projectId, response.objects, [type]),
          objectsByLanguage: mergeProjectionCache(
            currentState.objectsByLanguage,
            projectId,
            language,
            response.objects,
            [type],
          ),
          markdownPreviews: markdownResponse
            ? mergeMarkdownPreviewFromObjects(currentState.markdownPreviews, markdownResponse.objects)
            : currentState.markdownPreviews,
          projectHydration: setProjectHydrationState(
            currentState.projectHydration,
            projectId,
            [hydrationKey],
            true,
          ),
          previewHydration: richPreviewType
            ? setProjectHydrationState(
              currentState.previewHydration,
              projectId,
              [hydrationKey],
              true,
            )
            : currentState.previewHydration,
        }));
      });

      return getProjectObjectsByType(
        projectId,
        type,
        get().objectsByLanguage[projectionCacheKey(projectId, language)] ?? get().objects,
      );
    } catch (error: any) {
      console.error('Failed to list objects:', error);
      throw error;
    }
  },

  refreshStoryEntityTree: async (projectId: string, options?: { force?: boolean; language?: string }) => {
    if (!projectId) return;

    const hydrationKey = storyTreeHydrationKey(options?.language);
    const typeKeys = STORY_ENTITY_TREE_TYPES.map((type) => collectionHydrationKey(type, options?.language));
    const state = get();
    const treeReady = isProjectHydrated(state.projectHydration, projectId, hydrationKey);
    const previewReady = isProjectHydrated(state.previewHydration, projectId, hydrationKey);
    if (!options?.force && treeReady && previewReady) {
      return;
    }

    await withCollectionRequestDeduped(projectId, hydrationKey, async () => {
      const [response, markdownResponse] = await Promise.all([
        unifiedObjectService.getStoryEntityTree(projectId, { language: options?.language, rich_text_format: 'tiptap' }),
        unifiedObjectService.getStoryEntityTree(projectId, { language: options?.language, rich_text_format: 'markdown' }),
      ]);
      const treeObjects = [...response.folders, ...response.entities];
      const markdownObjects = [...markdownResponse.folders, ...markdownResponse.entities];

      set((currentState) => ({
        objects: reconcileProjectObjects(currentState.objects, projectId, treeObjects, STORY_ENTITY_TREE_TYPES),
        objectsByLanguage: mergeProjectionCache(
          currentState.objectsByLanguage,
          projectId,
          options?.language,
          treeObjects,
          STORY_ENTITY_TREE_TYPES,
        ),
        markdownPreviews: mergeMarkdownPreviewFromObjects(currentState.markdownPreviews, markdownObjects),
        projectHydration: setProjectHydrationState(
          currentState.projectHydration,
          projectId,
          [hydrationKey, ...typeKeys],
          true,
        ),
        previewHydration: setProjectHydrationState(
          currentState.previewHydration,
          projectId,
          [hydrationKey, ...typeKeys],
          true,
        ),
      }));
    });
  },

  refreshProjectObjects: async (projectId: string, types: ObjectType[], language?: string) => {
    if (!projectId || types.length === 0) return;

    const uniqueTypes = [...new Set(types)];
    const requests: Promise<unknown>[] = [];
    const directTypes = uniqueTypes.filter((type) => !isStoryEntityTreeType(type));

    if (uniqueTypes.some((type) => isStoryEntityTreeType(type))) {
      requests.push(get().refreshStoryEntityTree(projectId, { language }));
    }

    for (const type of directTypes) {
      requests.push(get().listObjects(type, projectId, language));
    }

    await Promise.all(requests);
  },

  createObject: async (type: ObjectType, projectId: string, data: any, language: string, metadata?: Record<string, any>, userRequest: string = 'User Creation', kind?: StoryEntityKind | OutlineKind) => {
    try {
      const newObject = await unifiedObjectService.createObject(type, projectId, {
        data,
        language,
        rich_text_format: defaultRichTextFormatForType(type),
        kind,
        user_request: userRequest,
        metadata,
      });
      const markdownObject = isRichPreviewType(type)
        ? await unifiedObjectService.getObject(type, newObject.id, language, 'markdown')
        : null;

      set((state) => ({
        objects: { ...state.objects, [newObject.id]: newObject },
        objectsByLanguage: upsertProjectionObject(state.objectsByLanguage, newObject, language),
        markdownPreviews: markdownObject
          ? mergeMarkdownPreviewFromObject(state.markdownPreviews, markdownObject)
          : state.markdownPreviews,
        loading: { ...state.loading, [newObject.id]: false },
        projectHydration: (
          isStoryEntityTreeType(type)
            ? setProjectHydrationState(
              state.projectHydration,
              projectId,
              [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
              false,
            )
            : type === 'outline'
              ? setProjectHydrationState(
                state.projectHydration,
                projectId,
                ['outline'],
                false,
              )
              : state.projectHydration
        ),
        previewHydration: (
          isStoryEntityTreeType(type)
            ? setProjectHydrationState(
              state.previewHydration,
              projectId,
              [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
              false,
            )
            : type === 'outline' || isRichPreviewType(type)
              ? setProjectHydrationState(
                state.previewHydration,
                projectId,
                [type],
                false,
              )
              : state.previewHydration
        ),
      }));

      if (type === 'outline') {
        await reloadOutlineObjects(projectId);
      }

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

  patchObjectStructure: async (type: StoryEntityStructureObjectType, id: string, metadata: Record<string, any>) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      const updatedObject = await unifiedObjectService.patchObjectStructure(type, id, { metadata });
      set((state) => ({
        objects: { ...state.objects, [updatedObject.id]: updatedObject },
        objectsByLanguage: upsertProjectionObject(state.objectsByLanguage, updatedObject),
        loading: { ...state.loading, [id]: false },
        projectHydration: updatedObject.metadata?.project_id
          ? setProjectHydrationState(
            state.projectHydration,
            updatedObject.metadata.project_id,
              [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
              false,
            )
          : state.projectHydration,
        previewHydration: updatedObject.metadata?.project_id
          ? setProjectHydrationState(
            state.previewHydration,
            updatedObject.metadata.project_id,
            [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
            false,
          )
          : state.previewHydration,
      }));
    } catch (error: any) {
      set((state) => ({
        errors: { ...state.errors, [id]: error.message || 'Failed to update object structure' },
        loading: { ...state.loading, [id]: false },
      }));
      throw error;
    }
  },

  deleteObject: async (type: ObjectType, id: string) => {
    set((state) => ({
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: null },
    }));

    try {
      const existingObject = get().objects[id];
      const projectId = existingObject?.metadata?.project_id;
      const deletedSubtree = (
        type === 'story_entity_folder'
        && projectId
        && existingObject
      ) ? collectStoryEntitySubtreeIds(get().objects, projectId, id) : null;

      await unifiedObjectService.deleteObject(type, id);

      // Remove object from cache
      set((state) => {
        const newObjects = { ...state.objects };
        let newObjectsByLanguage = state.objectsByLanguage;
        let newMarkdownPreviews = state.markdownPreviews;
        const newLoading = { ...state.loading };
        const newErrors = { ...state.errors };
        const removedIds = deletedSubtree
          ? [...deletedSubtree.folderIds, ...deletedSubtree.entityIds]
          : [id];

        for (const removedId of removedIds) {
          delete newObjects[removedId];
          newObjectsByLanguage = deleteProjectionObject(newObjectsByLanguage, removedId);
          newMarkdownPreviews = removeMarkdownPreview(newMarkdownPreviews, removedId);
          delete newLoading[removedId];
          delete newErrors[removedId];
        }

        return {
          objects: newObjects,
          objectsByLanguage: newObjectsByLanguage,
          markdownPreviews: newMarkdownPreviews,
          loading: newLoading,
          errors: newErrors,
          projectHydration: (
            projectId
              ? isStoryEntityTreeType(type)
                ? setProjectHydrationState(
                  state.projectHydration,
                  projectId,
                  [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
                  false,
                )
                : type === 'outline'
                  ? setProjectHydrationState(
                    state.projectHydration,
                    projectId,
                    ['outline'],
                    false,
                  )
                  : state.projectHydration
              : state.projectHydration
          ),
          previewHydration: (
            projectId
              ? isStoryEntityTreeType(type)
                ? setProjectHydrationState(
                  state.previewHydration,
                  projectId,
                  [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
                  false,
                )
                : type === 'outline' || isRichPreviewType(type)
                  ? setProjectHydrationState(
                    state.previewHydration,
                    projectId,
                    [type],
                    false,
                  )
                  : state.previewHydration
              : state.previewHydration
          ),
        };
      });

      if (type === 'story_entity_folder' && projectId) {
        void get().refreshStoryEntityTree(projectId).catch((refreshError) => {
          console.error('Failed to reconcile story entity tree after folder delete:', refreshError);
        });
      }
      if (type === 'outline' && projectId) {
        await reloadOutlineObjects(projectId);
      }
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

  getObjectsForProject: (projectId: string, language?: string) => {
    const state = get();
    const projectionObjects = state.objectsByLanguage[projectionCacheKey(projectId, language)];
    if (projectionObjects) return projectionObjects;
    return state.objects;
  },

  getRichTextMarkdown: (objectId: string, language: string, fieldName: RichFieldName) => (
    getRichTextMarkdownFromCache(get().markdownPreviews, objectId, language, fieldName)
  ),

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
      const existingObject = state.objects[id];
      const newObjects = { ...state.objects };
      const newObjectsByLanguage = deleteProjectionObject(state.objectsByLanguage, id);
      const newMarkdownPreviews = removeMarkdownPreview(state.markdownPreviews, id);
      const newLoading = { ...state.loading };
      const newErrors = { ...state.errors };

      delete newObjects[id];
      delete newLoading[id];
      delete newErrors[id];

      return {
        objects: newObjects,
        objectsByLanguage: newObjectsByLanguage,
        markdownPreviews: newMarkdownPreviews,
        loading: newLoading,
        errors: newErrors,
        projectHydration: (
          existingObject?.metadata?.project_id
            ? isStoryEntityTreeType(existingObject.type)
              ? setProjectHydrationState(
                state.projectHydration,
                existingObject.metadata.project_id,
                [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
                false,
              )
              : existingObject.type === 'outline'
                ? setProjectHydrationState(
                  state.projectHydration,
                  existingObject.metadata.project_id,
                  ['outline'],
                  false,
                )
                : state.projectHydration
            : state.projectHydration
        ),
        previewHydration: (
          existingObject?.metadata?.project_id
            ? isStoryEntityTreeType(existingObject.type)
              ? setProjectHydrationState(
                state.previewHydration,
                existingObject.metadata.project_id,
                [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
                false,
              )
              : existingObject.type === 'outline' || isRichPreviewType(existingObject.type)
                ? setProjectHydrationState(
                  state.previewHydration,
                  existingObject.metadata.project_id,
                  [existingObject.type],
                  false,
                )
                : state.previewHydration
            : state.previewHydration
        ),
      };
    });
  },

  clearAllObjects: () => {
    collectionRequestInflight.clear();
    outlineCollectionRevision.clear();
    set({
      objects: {},
      objectsByLanguage: {},
      projectHydration: {},
      markdownPreviews: {},
      previewHydration: {},
      loading: {},
      errors: {},
      translating: {},
    });
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

      const availableLanguages = obj.language_state?.available_languages ?? [];
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
          const nextObject = {
            ...existingObject,
            metadata: {
              ...existingObject.metadata,
              image_prompt: result.image_prompt,
              image_prompt_positive: result.image_prompt_positive,
              image_prompt_negative: result.image_prompt_negative,
            },
          };
          return {
            objects: {
              ...state.objects,
              [id]: nextObject,
            },
            objectsByLanguage: upsertProjectionObject(state.objectsByLanguage, nextObject),
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

  applyObjectChanges: ({ upserts = [], markdownUpserts = [], deletes = [] }) => {
    if (!upserts.length && !markdownUpserts.length && !deletes.length) return;
    set((state) => {
      const nextObjects = { ...state.objects };
      let nextObjectsByLanguage = state.objectsByLanguage;
      let nextMarkdownPreviews = state.markdownPreviews;
      const nextLoading = { ...state.loading };
      const nextErrors = { ...state.errors };
      const nextTranslating = { ...state.translating };
      let nextProjectHydration = state.projectHydration;
      let nextPreviewHydration = state.previewHydration;
      const touchedTreeProjects = new Set<string>();
      const touchedOutlineProjects = new Set<string>();
      const touchedPreviewProjectsByType = new Map<string, Set<ProjectHydrationKey>>();

      for (const obj of upserts) {
        // Only invalidate collection hydration for NEW objects (not already in
        // store).  Updates to existing objects are merged directly into the
        // store below and do not require a full collection re-fetch.  This
        // prevents an SSE-driven cascade where every object:changed event
        // triggers redundant collection re-fetches.
        const isNew = !state.objects[obj.id];
        nextObjects[obj.id] = obj;
        nextObjectsByLanguage = upsertProjectionObject(nextObjectsByLanguage, obj);
        if (isNew && isStoryEntityTreeType(obj.type) && obj.metadata?.project_id) {
          touchedTreeProjects.add(obj.metadata.project_id);
        }
        if (isNew && obj.type === 'outline' && obj.metadata?.project_id) {
          touchedOutlineProjects.add(obj.metadata.project_id);
        }
        if (isNew && isRichPreviewType(obj.type) && obj.metadata?.project_id) {
          const keys = touchedPreviewProjectsByType.get(obj.metadata.project_id) ?? new Set<ProjectHydrationKey>();
          keys.add(obj.type);
          if (isStoryEntityTreeType(obj.type)) {
            keys.add(STORY_ENTITY_TREE_HYDRATION_KEY);
            keys.add('story_entity');
          }
          touchedPreviewProjectsByType.set(obj.metadata.project_id, keys);
        }
      }
      for (const id of deletes) {
        const existingObject = state.objects[id];
        if (
          existingObject
          && isStoryEntityTreeType(existingObject.type)
          && existingObject.metadata?.project_id
        ) {
          touchedTreeProjects.add(existingObject.metadata.project_id);
        }
        if (
          existingObject
          && existingObject.type === 'outline'
          && existingObject.metadata?.project_id
        ) {
          touchedOutlineProjects.add(existingObject.metadata.project_id);
        }
        if (
          existingObject
          && isRichPreviewType(existingObject.type)
          && existingObject.metadata?.project_id
        ) {
          const keys = touchedPreviewProjectsByType.get(existingObject.metadata.project_id) ?? new Set<ProjectHydrationKey>();
          keys.add(existingObject.type);
          if (isStoryEntityTreeType(existingObject.type)) {
            keys.add(STORY_ENTITY_TREE_HYDRATION_KEY);
            keys.add('story_entity');
          }
          touchedPreviewProjectsByType.set(existingObject.metadata.project_id, keys);
        }
        delete nextObjects[id];
        nextObjectsByLanguage = deleteProjectionObject(nextObjectsByLanguage, id);
        nextMarkdownPreviews = removeMarkdownPreview(nextMarkdownPreviews, id);
        delete nextLoading[id];
        delete nextErrors[id];
        delete nextTranslating[id];
      }

      for (const markdownObject of markdownUpserts) {
        nextMarkdownPreviews = mergeMarkdownPreviewFromObject(nextMarkdownPreviews, markdownObject);
      }

      touchedTreeProjects.forEach((projectId) => {
        nextProjectHydration = setProjectHydrationState(
          nextProjectHydration,
          projectId,
          [STORY_ENTITY_TREE_HYDRATION_KEY, ...STORY_ENTITY_TREE_TYPES],
          false,
        );
      });
      touchedOutlineProjects.forEach((projectId) => {
        nextProjectHydration = setProjectHydrationState(
          nextProjectHydration,
          projectId,
          ['outline'],
          false,
        );
      });
      touchedPreviewProjectsByType.forEach((keys, projectId) => {
        nextPreviewHydration = setProjectHydrationState(
          nextPreviewHydration,
          projectId,
          [...keys],
          false,
        );
      });

      return {
        objects: nextObjects,
        objectsByLanguage: nextObjectsByLanguage,
        markdownPreviews: nextMarkdownPreviews,
        projectHydration: nextProjectHydration,
        previewHydration: nextPreviewHydration,
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
  storyEntities: Array<{ id: string; kind: StoryEntityKind; name: string; description: string; content: TipTapDoc }>;
  characters: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  organizations: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  locations: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  lorebook: Array<{ id: string; name: string; description: string; content: TipTapDoc }>;
  outline: {
    outlines: Array<{
      id: string;
      name: string;
      description: string;
      content: TipTapDoc;
      position: number;
      acts: Array<{
        id: string;
        name: string;
        description: string;
        content: TipTapDoc;
        position: number;
        parentId: string;
        chapters: Array<{
          id: string;
          name: string;
          description: string;
          content: TipTapDoc;
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
  void language;
  return (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data))
    ? obj.data as Record<string, any>
    : {};
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
      outlines: sortOutlineObjects(outlines)
        .map(outlineObj => {
          const outlineData = getObjectDataForLanguage(outlineObj, language);
          return {
            id: outlineObj.id,
            name: outlineData.name || '',
            description: outlineData.description || '',
            content: normalizeDoc(outlineData.content),
            position: outlineObj.metadata.position || 0,
            acts: sortOutlineObjects(
              acts.filter(act => act.metadata.parent_id === outlineObj.id)
            )
              .map(act => {
                const actData = getObjectDataForLanguage(act, language);
                return {
                  id: act.id,
                  name: actData.name || '',
                  description: actData.description || '',
                  content: normalizeDoc(actData.content),
                  position: act.metadata.position || 0,
                  parentId: act.metadata.parent_id || '',
                  chapters: sortOutlineObjects(
                    chapters.filter(ch => ch.metadata.parent_id === act.id)
                  )
                    .map(chapter => {
                      const chapterData = getObjectDataForLanguage(chapter, language);
                      return {
                        id: chapter.id,
                        name: chapterData.name || '',
                        description: chapterData.description || '',
                        content: normalizeDoc(chapterData.content),
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
          content: normalizeDoc(data.content),
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
            content: normalizeDoc(data.content),
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
            content: normalizeDoc(data.content),
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
            content: normalizeDoc(data.content),
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
            content: normalizeDoc(data.content),
          };
        }),
      outline,
    };
  }, [objects, projectId, language]);
}

export default useUnifiedObjectStore;
