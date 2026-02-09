export interface PatchOperationGroupItem<T = unknown> {
  id: string;
  type?: string;
  targetId?: string;
  label: string;
  value: T;
}

export interface PatchOperationGroup<T = unknown> {
  id: string;
  type?: string;
  targetId?: string;
  label: string;
  items: PatchOperationGroupItem<T>[];
}

function buildGroupKey(item: PatchOperationGroupItem): string {
  if (!item.targetId) return `singleton:${item.id}`;
  return `${item.type ?? 'unknown'}:${item.targetId}`;
}

export function groupPatchOperations<T>(
  items: PatchOperationGroupItem<T>[]
): PatchOperationGroup<T>[] {
  const orderedKeys: string[] = [];
  const groupsByKey = new Map<string, PatchOperationGroup<T>>();

  for (const item of items) {
    const key = buildGroupKey(item);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    orderedKeys.push(key);
    groupsByKey.set(key, {
      id: key,
      type: item.type,
      targetId: item.targetId,
      label: item.label,
      items: [item],
    });
  }

  return orderedKeys.map((key) => groupsByKey.get(key)!);
}
