/**
 * Outline ordering + numbering — single source of truth.
 *
 * Consolidates logic previously duplicated across:
 * - utils/outlineOrdering.ts (compareOutlineOrder/sortOutlineObjects)
 * - components/ObjectPicker/useObjectPickerData.ts (compareOutlineItems/buildOutlineNumbering)
 * - store/unifiedObjectStore.ts useProjectObjects (inline sort)
 */

import type { UnifiedObject } from '../types/unifiedObject';

/** Canonical outline ordering: position → created_at → id. */
export function compareOutlineOrder(a: UnifiedObject, b: UnifiedObject): number {
  const positionA = Number(a.metadata?.position ?? 0);
  const positionB = Number(b.metadata?.position ?? 0);
  if (positionA !== positionB) {
    return positionA - positionB;
  }

  const createdAtA = typeof a.metadata?.created_at === 'string' ? a.metadata.created_at : '';
  const createdAtB = typeof b.metadata?.created_at === 'string' ? b.metadata.created_at : '';
  if (createdAtA !== createdAtB) {
    return createdAtA.localeCompare(createdAtB);
  }

  return a.id.localeCompare(b.id);
}

export function sortOutlineObjects<T extends UnifiedObject>(items: T[]): T[] {
  return [...items].sort(compareOutlineOrder);
}

export interface OutlineNumbering {
  actNumberById: Map<string, number>;
  chapterNumberById: Map<string, number>;
  actNumberByChapterId: Map<string, number>;
}

/**
 * Compute sequential act/chapter numbers across the whole outline tree.
 * Acts are numbered globally (across all outlines), chapters globally too,
 * matching the prior ObjectPicker behaviour.
 */
export function buildOutlineNumbering(outlineItems: UnifiedObject[]): OutlineNumbering {
  const actNumberById = new Map<string, number>();
  const chapterNumberById = new Map<string, number>();
  const actNumberByChapterId = new Map<string, number>();
  const childrenByParent = new Map<string | null, UnifiedObject[]>();

  outlineItems.forEach((item) => {
    const parentId = (item.metadata?.parent_id as string | undefined) ?? null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(parentId, siblings);
  });

  childrenByParent.forEach((items) => items.sort(compareOutlineOrder));

  for (const root of childrenByParent.get(null) ?? []) {
    if (root.kind !== 'outline') {
      continue;
    }

    let actNumber = 0;
    let chapterNumber = 0;

    for (const act of childrenByParent.get(root.id) ?? []) {
      if (act.kind !== 'act') {
        continue;
      }

      actNumber += 1;
      actNumberById.set(act.id, actNumber);

      for (const chapter of childrenByParent.get(act.id) ?? []) {
        if (chapter.kind !== 'chapter') {
          continue;
        }

        chapterNumber += 1;
        chapterNumberById.set(chapter.id, chapterNumber);
        actNumberByChapterId.set(chapter.id, actNumber);
      }
    }
  }

  return { actNumberById, chapterNumberById, actNumberByChapterId };
}
