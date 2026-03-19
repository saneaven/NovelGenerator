import type {
  StoryEntityObject,
  StoryEntityStructureObjectType,
  UnifiedObject,
} from '../types/unifiedObject';
import {
  getStoryEntityFolderDescription,
  getStoryEntityFolderName,
  type StoryEntityFolder,
  type StoryEntityTreeNode,
} from '../types/storyEntityFolder';

export type StoryEntityTreeObjects = Record<string, UnifiedObject>;

export interface StoryEntityStructurePatch {
  objectType: StoryEntityStructureObjectType;
  objectId: string;
  metadata: Record<string, string | number | null | undefined>;
}

type MixedSiblingNode =
  | {
      nodeKind: 'folder';
      object: StoryEntityFolder;
      id: string;
      parentId: string | null;
      displayOrder: number;
    }
  | {
      nodeKind: 'entity';
      object: StoryEntityObject;
      id: string;
      parentId: string | null;
      displayOrder: number;
    };

function nodeKindWeight(nodeKind: 'folder' | 'entity'): number {
  return nodeKind === 'folder' ? 0 : 1;
}

function mixedSiblingSort(a: MixedSiblingNode, b: MixedSiblingNode): number {
  if (a.displayOrder === b.displayOrder) {
    const kindOrder = nodeKindWeight(a.nodeKind) - nodeKindWeight(b.nodeKind);
    if (kindOrder !== 0) {
      return kindOrder;
    }
    return a.id.localeCompare(b.id);
  }
  return a.displayOrder - b.displayOrder;
}

function normalizeParentId(value: string | null | undefined): string | null {
  return value ?? null;
}

export function getProjectStoryEntityFolders(
  objects: StoryEntityTreeObjects,
  projectId: string | undefined,
): StoryEntityFolder[] {
  if (!projectId) return [];
  return Object.values(objects).filter(
    (object): object is StoryEntityFolder =>
      object.type === 'story_entity_folder' && object.metadata.project_id === projectId,
  );
}

export function getProjectStoryEntities(
  objects: StoryEntityTreeObjects,
  projectId: string | undefined,
): StoryEntityObject[] {
  if (!projectId) return [];
  return Object.values(objects).filter(
    (object): object is StoryEntityObject =>
      object.type === 'story_entity' && object.metadata.project_id === projectId,
  );
}

export function sortStoryEntityFolders(
  folders: StoryEntityFolder[],
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): StoryEntityFolder[] {
  return [...folders].sort((a, b) => {
    const orderA = a.metadata.display_order ?? 0;
    const orderB = b.metadata.display_order ?? 0;
    if (orderA === orderB) {
      return getStoryEntityFolderName(a, preferredLanguage, fallbackLanguage).localeCompare(
        getStoryEntityFolderName(b, preferredLanguage, fallbackLanguage),
      );
    }
    return orderA - orderB;
  });
}

export function sortStoryEntityObjects(
  entities: StoryEntityObject[],
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): StoryEntityObject[] {
  return [...entities].sort((a, b) => {
    const orderA = a.metadata.display_order ?? 0;
    const orderB = b.metadata.display_order ?? 0;
    if (orderA === orderB) {
      const nameA = getStoryEntityObjectName(a, preferredLanguage, fallbackLanguage);
      const nameB = getStoryEntityObjectName(b, preferredLanguage, fallbackLanguage);
      return nameA.localeCompare(nameB);
    }
    return orderA - orderB;
  });
}

export function getStoryEntityObjectName(
  entity: StoryEntityObject,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): string {
  const preferred = preferredLanguage ? entity.data[preferredLanguage] : undefined;
  if (preferred?.name) return preferred.name;
  const fallback = fallbackLanguage ? entity.data[fallbackLanguage] : undefined;
  if (fallback?.name) return fallback.name;
  const firstLanguage = Object.keys(entity.data)[0];
  return entity.data[firstLanguage]?.name || '';
}

export function buildFolderChildrenMap(
  folders: StoryEntityFolder[],
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): Map<string | null, StoryEntityFolder[]> {
  const map = new Map<string | null, StoryEntityFolder[]>();
  for (const folder of sortStoryEntityFolders(folders, preferredLanguage, fallbackLanguage)) {
    const parentId = normalizeParentId(folder.metadata.parent_id);
    const siblings = map.get(parentId) ?? [];
    siblings.push(folder);
    map.set(parentId, siblings);
  }
  return map;
}

export function buildEntityCountByFolder(entities: StoryEntityObject[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const entity of entities) {
    const folderId = normalizeParentId(entity.metadata.folder_id);
    counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
  }
  return counts;
}

export function buildFolderPathLabel(
  folderId: string,
  foldersById: Record<string, StoryEntityFolder>,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): string {
  const parts: string[] = [];
  let currentId: string | null = folderId;
  while (currentId) {
    const current = foldersById[currentId];
    if (!current) break;
    parts.unshift(getStoryEntityFolderName(current, preferredLanguage, fallbackLanguage));
    currentId = normalizeParentId(current.metadata.parent_id);
  }
  return parts.join(' / ');
}

export function buildStoryEntityTree(
  folders: StoryEntityFolder[],
  entities: UnifiedObject[],
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): StoryEntityTreeNode[] {
  const folderNodeMap = new Map<string, StoryEntityTreeNode>();

  for (const folder of folders) {
    folderNodeMap.set(folder.id, {
      id: folder.id,
      folder,
      parentId: normalizeParentId(folder.metadata.parent_id),
      folders: [],
      entities: [],
    });
  }

  const roots: StoryEntityTreeNode[] = [];

  for (const folder of sortStoryEntityFolders(folders, preferredLanguage, fallbackLanguage)) {
    const node = folderNodeMap.get(folder.id);
    if (!node) continue;
    const parentId = normalizeParentId(folder.metadata.parent_id);
    if (parentId && folderNodeMap.has(parentId)) {
      folderNodeMap.get(parentId)?.folders.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortedEntities = sortStoryEntityObjects(
    entities.filter((object): object is StoryEntityObject => object.type === 'story_entity'),
    preferredLanguage,
    fallbackLanguage,
  );

  for (const entity of sortedEntities) {
    const parentId = normalizeParentId(entity.metadata.folder_id);
    if (parentId && folderNodeMap.has(parentId)) {
      folderNodeMap.get(parentId)?.entities.push(entity);
      continue;
    }
    roots.push({
      id: `root-entity-${entity.id}`,
      folder: null,
      parentId: null,
      folders: [],
      entities: [entity],
    });
  }

  return roots.sort((a, b) => {
    const orderA = a.folder?.metadata.display_order ?? a.entities[0]?.metadata.display_order ?? 0;
    const orderB = b.folder?.metadata.display_order ?? b.entities[0]?.metadata.display_order ?? 0;
    if (orderA === orderB) {
      const kindA = a.folder ? 0 : 1;
      const kindB = b.folder ? 0 : 1;
      if (kindA !== kindB) {
        return kindA - kindB;
      }
      const labelA = a.folder
        ? getStoryEntityFolderName(a.folder, preferredLanguage, fallbackLanguage)
        : getStoryEntityObjectName(a.entities[0] as StoryEntityObject, preferredLanguage, fallbackLanguage);
      const labelB = b.folder
        ? getStoryEntityFolderName(b.folder, preferredLanguage, fallbackLanguage)
        : getStoryEntityObjectName(b.entities[0] as StoryEntityObject, preferredLanguage, fallbackLanguage);
      return labelA.localeCompare(labelB);
    }
    return orderA - orderB;
  });
}

export function collectDescendantStoryEntityIds(node: StoryEntityTreeNode): string[] {
  const ids = node.entities.map((entity) => entity.id);
  for (const folder of node.folders) {
    ids.push(...collectDescendantStoryEntityIds(folder));
  }
  return ids;
}

export function collectStoryEntitySubtreeIds(
  objects: StoryEntityTreeObjects,
  projectId: string,
  folderId: string,
): { folderIds: string[]; entityIds: string[] } {
  const folders = getProjectStoryEntityFolders(objects, projectId);
  const entities = getProjectStoryEntities(objects, projectId);
  const byParent = buildFolderChildrenMap(folders);
  const folderIds: string[] = [];

  const walk = (currentFolderId: string) => {
    folderIds.push(currentFolderId);
    for (const child of byParent.get(currentFolderId) ?? []) {
      walk(child.id);
    }
  };

  walk(folderId);

  const folderIdSet = new Set(folderIds);
  const entityIds = entities
    .filter((entity) => {
      const entityFolderId = normalizeParentId(entity.metadata.folder_id);
      return entityFolderId !== null && folderIdSet.has(entityFolderId);
    })
    .map((entity) => entity.id);

  return { folderIds, entityIds };
}

function buildMixedSiblings(
  objects: StoryEntityTreeObjects,
  projectId: string,
  parentFolderId: string | null,
): MixedSiblingNode[] {
  const folders = getProjectStoryEntityFolders(objects, projectId)
    .filter((folder) => normalizeParentId(folder.metadata.parent_id) === parentFolderId)
    .map<MixedSiblingNode>((folder) => ({
      nodeKind: 'folder',
      object: folder,
      id: folder.id,
      parentId: parentFolderId,
      displayOrder: folder.metadata.display_order ?? 0,
    }));
  const entities = getProjectStoryEntities(objects, projectId)
    .filter((entity) => normalizeParentId(entity.metadata.folder_id) === parentFolderId)
    .map<MixedSiblingNode>((entity) => ({
      nodeKind: 'entity',
      object: entity,
      id: entity.id,
      parentId: parentFolderId,
      displayOrder: entity.metadata.display_order ?? 0,
    }));
  return [...folders, ...entities].sort(mixedSiblingSort);
}

function cloneNodeWithStructure(
  node: MixedSiblingNode,
  parentFolderId: string | null,
  displayOrder: number,
): UnifiedObject {
  if (node.nodeKind === 'folder') {
    return {
      ...node.object,
      metadata: {
        ...node.object.metadata,
        parent_id: parentFolderId,
        display_order: displayOrder,
      },
    };
  }
  return {
    ...node.object,
    metadata: {
      ...node.object.metadata,
      folder_id: parentFolderId,
      display_order: displayOrder,
    },
  };
}

function insertNodeAtIndex(
  siblings: MixedSiblingNode[],
  node: MixedSiblingNode,
  requestedIndex?: number | null,
): MixedSiblingNode[] {
  const next = [...siblings];
  if (requestedIndex == null) {
    next.push(node);
    return next;
  }
  const boundedIndex = Math.max(0, Math.min(requestedIndex, next.length));
  next.splice(boundedIndex, 0, node);
  return next;
}

function wouldCreateFolderCycle(
  objects: StoryEntityTreeObjects,
  projectId: string,
  folderId: string,
  newParentFolderId: string | null,
): boolean {
  if (!newParentFolderId) return false;
  if (folderId === newParentFolderId) return true;
  const foldersById = Object.fromEntries(
    getProjectStoryEntityFolders(objects, projectId).map((folder) => [folder.id, folder]),
  ) as Record<string, StoryEntityFolder>;
  let currentId: string | null = newParentFolderId;
  while (currentId) {
    if (currentId === folderId) return true;
    currentId = normalizeParentId(foldersById[currentId]?.metadata.parent_id);
  }
  return false;
}

export function applyStoryEntityStructurePatch(
  objects: StoryEntityTreeObjects,
  projectId: string,
  patch: StoryEntityStructurePatch,
): StoryEntityTreeObjects {
  const nextObjects: StoryEntityTreeObjects = { ...objects };
  const isFolder = patch.objectType === 'story_entity_folder';
  const current = nextObjects[patch.objectId];
  if (!current || current.metadata.project_id !== projectId) {
    return objects;
  }

  const currentParentId = isFolder
    ? normalizeParentId(current.metadata.parent_id)
    : normalizeParentId(current.metadata.folder_id);
  const requestedParentId = isFolder
    ? normalizeParentId(patch.metadata.parent_id as string | null | undefined)
    : normalizeParentId(patch.metadata.folder_id as string | null | undefined);
  const requestedIndexValue = patch.metadata.display_order;
  const requestedIndex = typeof requestedIndexValue === 'number' ? requestedIndexValue : undefined;

  if (
    isFolder
    && wouldCreateFolderCycle(objects, projectId, patch.objectId, requestedParentId)
  ) {
    return objects;
  }

  const sourceSiblings = buildMixedSiblings(objects, projectId, currentParentId).filter(
    (node) => node.id !== patch.objectId,
  );
  const movedNode = buildMixedSiblings(objects, projectId, currentParentId).find(
    (node) => node.id === patch.objectId,
  );
  if (!movedNode) {
    return objects;
  }

  if (currentParentId === requestedParentId) {
    const reordered = insertNodeAtIndex(sourceSiblings, movedNode, requestedIndex);
    reordered.forEach((node, index) => {
      nextObjects[node.id] = cloneNodeWithStructure(node, currentParentId, index);
    });
    return nextObjects;
  }

  sourceSiblings.forEach((node, index) => {
    nextObjects[node.id] = cloneNodeWithStructure(node, currentParentId, index);
  });

  const targetSiblings = buildMixedSiblings(objects, projectId, requestedParentId).filter(
    (node) => node.id !== patch.objectId,
  );
  const reorderedTarget = insertNodeAtIndex(
    targetSiblings,
    {
      ...movedNode,
      parentId: requestedParentId,
    },
    requestedIndex,
  );
  reorderedTarget.forEach((node, index) => {
    nextObjects[node.id] = cloneNodeWithStructure(
      node,
      node.id === patch.objectId ? requestedParentId : node.parentId,
      index,
    );
  });

  return nextObjects;
}

export function patchStoryEntityObjects(
  objects: StoryEntityTreeObjects,
  upserts: UnifiedObject[],
  removedIds: string[] = [],
): StoryEntityTreeObjects {
  const nextObjects = { ...objects };
  for (const object of upserts) {
    nextObjects[object.id] = object;
  }
  for (const objectId of removedIds) {
    delete nextObjects[objectId];
  }
  return nextObjects;
}

export function getFolderSummary(
  folder: StoryEntityFolder,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): { name: string; description: string } {
  return {
    name: getStoryEntityFolderName(folder, preferredLanguage, fallbackLanguage),
    description: getStoryEntityFolderDescription(folder, preferredLanguage, fallbackLanguage),
  };
}
