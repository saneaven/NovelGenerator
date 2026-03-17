import type { UnifiedObject } from '../types/unifiedObject';
import type { StoryEntityFolder, StoryEntityTreeNode } from '../types/storyEntityFolder';

function folderSort(a: StoryEntityFolder, b: StoryEntityFolder): number {
  if (a.display_order === b.display_order) {
    return a.name.localeCompare(b.name);
  }
  return a.display_order - b.display_order;
}

function entitySort(a: UnifiedObject, b: UnifiedObject): number {
  const orderA = a.metadata?.display_order ?? 0;
  const orderB = b.metadata?.display_order ?? 0;
  if (orderA === orderB) {
    const nameA = ((Object.values(a.data)[0] as any)?.name ?? '').toString();
    const nameB = ((Object.values(b.data)[0] as any)?.name ?? '').toString();
    return nameA.localeCompare(nameB);
  }
  return orderA - orderB;
}

export function buildStoryEntityTree(
  folders: StoryEntityFolder[],
  entities: UnifiedObject[],
): StoryEntityTreeNode[] {
  const folderNodeMap = new Map<string, StoryEntityTreeNode>();

  for (const folder of folders) {
    folderNodeMap.set(folder.id, {
      id: folder.id,
      folder,
      parentId: folder.parent_id,
      folders: [],
      entities: [],
    });
  }

  const roots: StoryEntityTreeNode[] = [];

  for (const folder of [...folders].sort(folderSort)) {
    const node = folderNodeMap.get(folder.id);
    if (!node) continue;
    if (folder.parent_id && folderNodeMap.has(folder.parent_id)) {
      folderNodeMap.get(folder.parent_id)?.folders.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const entity of [...entities].sort(entitySort)) {
    const parentId = entity.metadata?.folder_id ?? null;
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
    const orderA =
      a.folder?.display_order ??
      a.entities[0]?.metadata?.display_order ??
      0;
    const orderB =
      b.folder?.display_order ??
      b.entities[0]?.metadata?.display_order ??
      0;
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
