/**
 * Computes the parent closure for a set of selected leaf IDs.
 * Given leaf selections (chapters, story entities, manuscripts),
 * returns an expanded set that includes all ancestor IDs.
 *
 * Used in "all" mode where the UI only allows selecting leaves,
 * but the backend needs parent context IDs for tree rendering.
 */

import type { UnifiedObject } from '../types/unifiedObject';

/**
 * Compute parent closure: expand selected leaf IDs to include all ancestors.
 *
 * - chapter → parent act → parent outline
 * - story_entity → parent folder → parent folder (recursive)
 * - manuscript → linked chapter → parent act → parent outline
 */
export function computeParentClosure(
  selectedIds: string[],
  objectsById: Record<string, UnifiedObject>,
): string[] {
  const result = new Set(selectedIds);

  for (const id of selectedIds) {
    const obj = objectsById[id];
    if (!obj) continue;

    if (obj.type === 'outline' && obj.kind === 'chapter') {
      // chapter → act → outline
      addOutlineAncestors(obj, objectsById, result);
    } else if (obj.type === 'story_entity') {
      // story_entity → folder chain
      addFolderAncestors(obj.metadata?.folder_id as string | null | undefined, objectsById, result);
    } else if (obj.type === 'manuscript') {
      // manuscript → chapter → act → outline
      const chapterId = obj.metadata?.chapter_id as string | undefined;
      if (chapterId) {
        result.add(chapterId);
        const chapter = objectsById[chapterId];
        if (chapter) {
          addOutlineAncestors(chapter, objectsById, result);
        }
      }
    }
  }

  return Array.from(result);
}

function addOutlineAncestors(
  obj: UnifiedObject,
  objectsById: Record<string, UnifiedObject>,
  result: Set<string>,
): void {
  let parentId = obj.metadata?.parent_id as string | null | undefined;
  while (parentId) {
    result.add(parentId);
    const parent = objectsById[parentId];
    if (!parent) break;
    parentId = parent.metadata?.parent_id as string | null | undefined;
  }
}

function addFolderAncestors(
  folderId: string | null | undefined,
  objectsById: Record<string, UnifiedObject>,
  result: Set<string>,
): void {
  let currentId = folderId;
  while (currentId) {
    result.add(currentId);
    const folder = objectsById[currentId];
    if (!folder) break;
    currentId = folder.metadata?.parent_id as string | null | undefined;
  }
}
