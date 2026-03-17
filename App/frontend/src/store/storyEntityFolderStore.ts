import { create } from 'zustand';
import { storyEntityFolderService } from '../api/storyEntityFolderService';
import type {
  StoryEntityFolder,
  StoryEntityFolderDeleteResponse,
  StoryEntityTreeMoveRequest,
} from '../types/storyEntityFolder';
import type { StoryEntityObject, UnifiedObject } from '../types/unifiedObject';
import { useUnifiedObjectStore } from './unifiedObjectStore';

interface StoryEntityFolderStore {
  foldersById: Record<string, StoryEntityFolder>;
  loadingByProject: Record<string, boolean>;
  languageByProject: Record<string, string | undefined>;
  fetchFolders: (projectId: string, language?: string) => Promise<StoryEntityFolder[]>;
  createFolder: (projectId: string, payload: { language: string; name: string; description?: string; parent_id?: string | null }) => Promise<StoryEntityFolder>;
  updateFolder: (projectId: string, folderId: string, payload: { language: string; name?: string; description?: string }) => Promise<StoryEntityFolder>;
  moveFolder: (projectId: string, folderId: string, payload: { new_parent_id?: string | null; new_index?: number }) => Promise<StoryEntityFolder>;
  deleteFolder: (projectId: string, folderId: string) => Promise<StoryEntityFolderDeleteResponse>;
  moveTreeNode: (projectId: string, payload: StoryEntityTreeMoveRequest) => Promise<void>;
  clear: () => void;
}

function upsertFolders(
  state: StoryEntityFolderStore,
  folders: StoryEntityFolder[],
): Record<string, StoryEntityFolder> {
  const next = { ...state.foldersById };
  for (const folder of folders) {
    next[folder.id] = folder;
  }
  return next;
}

function sortFoldersByDisplayOrder(a: StoryEntityFolder, b: StoryEntityFolder): number {
  if (a.display_order === b.display_order) {
    return a.id.localeCompare(b.id);
  }
  return a.display_order - b.display_order;
}

function sortEntitiesByDisplayOrder(a: StoryEntityObject, b: StoryEntityObject): number {
  const orderA = a.metadata.display_order ?? 0;
  const orderB = b.metadata.display_order ?? 0;
  if (orderA === orderB) {
    return a.id.localeCompare(b.id);
  }
  return orderA - orderB;
}

function insertAtIndex<T>(items: T[], item: T, requestedIndex?: number): T[] {
  const next = [...items];
  const boundedIndex = requestedIndex == null
    ? next.length
    : Math.max(0, Math.min(requestedIndex, next.length));
  next.splice(boundedIndex, 0, item);
  return next;
}

function normalizeFoldersAfterMove(
  foldersById: Record<string, StoryEntityFolder>,
  projectId: string,
  folderId: string,
  newParentId: string | null,
  newIndex?: number,
): Record<string, StoryEntityFolder> {
  const movedFolder = foldersById[folderId];
  if (!movedFolder) return foldersById;

  const nextFolders = { ...foldersById };
  const projectFolders = Object.values(foldersById).filter((folder) => folder.project_id === projectId);
  const sourceParentId = movedFolder.parent_id ?? null;

  if (sourceParentId === newParentId) {
    const siblings = projectFolders
      .filter((folder) => (folder.parent_id ?? null) === sourceParentId && folder.id !== folderId)
      .sort(sortFoldersByDisplayOrder);
    const reordered = insertAtIndex(
      siblings,
      { ...movedFolder, parent_id: newParentId },
      newIndex,
    );
    reordered.forEach((folder, index) => {
      nextFolders[folder.id] = {
        ...folder,
        parent_id: newParentId,
        display_order: index,
      };
    });
    return nextFolders;
  }

  const sourceSiblings = projectFolders
    .filter((folder) => (folder.parent_id ?? null) === sourceParentId && folder.id !== folderId)
    .sort(sortFoldersByDisplayOrder);
  sourceSiblings.forEach((folder, index) => {
    nextFolders[folder.id] = {
      ...folder,
      display_order: index,
    };
  });

  const targetSiblings = projectFolders
    .filter((folder) => (folder.parent_id ?? null) === newParentId && folder.id !== folderId)
    .sort(sortFoldersByDisplayOrder);
  const reorderedTarget = insertAtIndex(
    targetSiblings,
    { ...movedFolder, parent_id: newParentId },
    newIndex,
  );
  reorderedTarget.forEach((folder, index) => {
    nextFolders[folder.id] = {
      ...folder,
      parent_id: folder.id === folderId ? newParentId : folder.parent_id,
      display_order: index,
    };
  });

  return nextFolders;
}

function normalizeStoryEntitiesAfterMove(
  objects: Record<string, UnifiedObject>,
  projectId: string,
  entityId: string,
  newParentId: string | null,
  newIndex?: number,
): Record<string, UnifiedObject> {
  const movedEntity = objects[entityId] as StoryEntityObject | undefined;
  if (!movedEntity || movedEntity.type !== 'story_entity' || movedEntity.metadata.project_id !== projectId) {
    return objects;
  }

  const nextObjects = { ...objects };
  const projectEntities = Object.values(objects)
    .filter((object): object is StoryEntityObject => object.type === 'story_entity' && object.metadata.project_id === projectId);
  const sourceParentId = movedEntity.metadata.folder_id ?? null;

  if (sourceParentId === newParentId) {
    const siblings = projectEntities
      .filter((entity) => (entity.metadata.folder_id ?? null) === sourceParentId && entity.id !== entityId)
      .sort(sortEntitiesByDisplayOrder);
    const reordered = insertAtIndex(
      siblings,
      {
        ...movedEntity,
        metadata: {
          ...movedEntity.metadata,
          folder_id: newParentId,
        },
      },
      newIndex,
    );
    reordered.forEach((entity, index) => {
      nextObjects[entity.id] = {
        ...entity,
        metadata: {
          ...entity.metadata,
          folder_id: newParentId,
          display_order: index,
        },
      };
    });
    return nextObjects;
  }

  const sourceSiblings = projectEntities
    .filter((entity) => (entity.metadata.folder_id ?? null) === sourceParentId && entity.id !== entityId)
    .sort(sortEntitiesByDisplayOrder);
  sourceSiblings.forEach((entity, index) => {
    nextObjects[entity.id] = {
      ...entity,
      metadata: {
        ...entity.metadata,
        display_order: index,
      },
    };
  });

  const targetSiblings = projectEntities
    .filter((entity) => (entity.metadata.folder_id ?? null) === newParentId && entity.id !== entityId)
    .sort(sortEntitiesByDisplayOrder);
  const reorderedTarget = insertAtIndex(
    targetSiblings,
    {
      ...movedEntity,
      metadata: {
        ...movedEntity.metadata,
        folder_id: newParentId,
      },
    },
    newIndex,
  );
  reorderedTarget.forEach((entity, index) => {
    nextObjects[entity.id] = {
      ...entity,
      metadata: {
        ...entity.metadata,
        folder_id: entity.id === entityId ? newParentId : entity.metadata.folder_id ?? null,
        display_order: index,
      },
    };
  });

  return nextObjects;
}

export const useStoryEntityFolderStore = create<StoryEntityFolderStore>((set, get) => ({
  foldersById: {},
  loadingByProject: {},
  languageByProject: {},

  fetchFolders: async (projectId, language) => {
    const resolvedLanguage = language ?? get().languageByProject[projectId];
    set((state) => ({
      loadingByProject: { ...state.loadingByProject, [projectId]: true },
    }));
    try {
      const folders = await storyEntityFolderService.list(projectId, resolvedLanguage);
      set((state) => ({
        foldersById: upsertFolders(state, folders),
        loadingByProject: { ...state.loadingByProject, [projectId]: false },
        languageByProject: { ...state.languageByProject, [projectId]: resolvedLanguage },
      }));
      return folders;
    } catch (error) {
      set((state) => ({
        loadingByProject: { ...state.loadingByProject, [projectId]: false },
      }));
      throw error;
    }
  },

  createFolder: async (projectId, payload) => {
    const folder = await storyEntityFolderService.create(projectId, payload);
    set((state) => ({
      foldersById: { ...state.foldersById, [folder.id]: folder },
      languageByProject: { ...state.languageByProject, [projectId]: payload.language },
    }));
    return folder;
  },

  updateFolder: async (projectId, folderId, payload) => {
    const folder = await storyEntityFolderService.update(projectId, folderId, payload);
    set((state) => ({
      foldersById: { ...state.foldersById, [folder.id]: folder },
      languageByProject: { ...state.languageByProject, [projectId]: payload.language },
    }));
    return folder;
  },

  moveFolder: async (projectId, folderId, payload) => {
    const previousFolders = get().foldersById;
    const optimisticFolders = normalizeFoldersAfterMove(
      previousFolders,
      projectId,
      folderId,
      payload.new_parent_id ?? null,
      payload.new_index,
    );

    set({ foldersById: optimisticFolders });

    try {
      const folder = await storyEntityFolderService.move(projectId, folderId, payload);
      void get().fetchFolders(projectId, get().languageByProject[projectId]).catch((error) => {
        console.error('Failed to reconcile folders after move:', error);
      });
      return folder;
    } catch (error) {
      set({ foldersById: previousFolders });
      throw error;
    }
  },

  deleteFolder: async (projectId, folderId) => {
    const response = await storyEntityFolderService.delete(projectId, folderId);
    set((state) => {
      const nextFolders = { ...state.foldersById };
      for (const deletedId of response.deleted_folder_ids) {
        delete nextFolders[deletedId];
      }
      return { foldersById: nextFolders };
    });
    useUnifiedObjectStore.getState().applyObjectChanges({ deletes: response.deleted_entity_ids });
    void get().fetchFolders(projectId, get().languageByProject[projectId]).catch((error) => {
      console.error('Failed to reconcile folders after delete:', error);
    });
    return response;
  },

  moveTreeNode: async (projectId, payload) => {
    const previousFolders = get().foldersById;
    const previousObjects = useUnifiedObjectStore.getState().objects;

    if (payload.node_kind === 'folder') {
      set({
        foldersById: normalizeFoldersAfterMove(
          previousFolders,
          projectId,
          payload.node_id,
          payload.new_parent_folder_id ?? null,
          payload.new_index,
        ),
      });
    } else {
      useUnifiedObjectStore.setState((state) => ({
        objects: normalizeStoryEntitiesAfterMove(
          state.objects,
          projectId,
          payload.node_id,
          payload.new_parent_folder_id ?? null,
          payload.new_index,
        ),
      }));
    }

    try {
      await storyEntityFolderService.moveTreeNode(projectId, payload);
      void Promise.all([
        get().fetchFolders(projectId, get().languageByProject[projectId]),
        useUnifiedObjectStore.getState().refreshProjectObjects(projectId, ['story_entity']),
      ]).catch((error) => {
        console.error('Failed to reconcile story entity tree after move:', error);
      });
    } catch (error) {
      set({ foldersById: previousFolders });
      useUnifiedObjectStore.setState({ objects: previousObjects });
      throw error;
    }
  },

  clear: () => set({ foldersById: {}, loadingByProject: {}, languageByProject: {} }),
}));
