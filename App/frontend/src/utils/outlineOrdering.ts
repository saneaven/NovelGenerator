import type { OutlineObject } from '../types/unifiedObject';

export function compareOutlineOrder(a: OutlineObject, b: OutlineObject): number {
  const positionA = a.metadata.position ?? 0;
  const positionB = b.metadata.position ?? 0;
  if (positionA !== positionB) {
    return positionA - positionB;
  }

  const createdAtA = a.metadata.created_at ?? '';
  const createdAtB = b.metadata.created_at ?? '';
  if (createdAtA !== createdAtB) {
    return createdAtA.localeCompare(createdAtB);
  }

  return a.id.localeCompare(b.id);
}

export function sortOutlineObjects<T extends OutlineObject>(items: T[]): T[] {
  return [...items].sort(compareOutlineOrder);
}
