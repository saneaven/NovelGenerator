import type { ObjectOperationVM } from './types';

export interface PatchGroup {
  id: string;
  objectType: ObjectOperationVM['objectType'];
  targetId?: string;
  label: string;
  operations: ObjectOperationVM[];
}

function buildPatchGroupKey(operation: ObjectOperationVM): string {
  if (operation.objectType === 'basic_info') {
    return 'basic_info:project';
  }
  if (operation.objectType === 'guidelines') {
    const guidelinesId = operation.targetId || (typeof operation.args.id === 'string' ? operation.args.id : undefined);
    return guidelinesId ? `guidelines:${guidelinesId}` : 'guidelines:project';
  }

  const targetId = operation.targetId || (typeof operation.args.id === 'string' ? operation.args.id : undefined);
  if (!targetId) return `singleton:${operation.id}`;

  return `${operation.objectType}:${targetId}`;
}

function buildPatchGroupLabel(operation: ObjectOperationVM): string {
  if (operation.targetLabel && operation.targetLabel.trim()) {
    return operation.targetLabel;
  }

  if (operation.objectType === 'basic_info') {
    return 'Project Basic Info';
  }
  if (operation.objectType === 'guidelines') {
    return 'Guidelines';
  }

  const targetId = operation.targetId || (typeof operation.args.id === 'string' ? operation.args.id : undefined);
  return targetId || operation.title;
}

export function groupPatchOperations(operations: ObjectOperationVM[]): PatchGroup[] {
  const groupsByKey = new Map<string, PatchGroup>();
  const order: string[] = [];

  for (const operation of operations) {
    const key = buildPatchGroupKey(operation);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.operations.push(operation);
      continue;
    }

    order.push(key);
    groupsByKey.set(key, {
      id: key,
      objectType: operation.objectType,
      targetId: operation.targetId,
      label: buildPatchGroupLabel(operation),
      operations: [operation],
    });
  }

  return order.map((key) => groupsByKey.get(key)!).filter(Boolean);
}
