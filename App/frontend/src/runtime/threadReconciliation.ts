import type { ThreadRuntimeEvent } from '../api/sseClient';

const cursors = new Map<string, number>();
const pending = new Map<string, ThreadRuntimeEvent[]>();
const revisions = new Map<string, number>();
let generation = 0;

export function reconciliationGeneration(): number {
  return generation;
}

export function runtimeTimestamp(value: string): number {
  const utc = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const fractional = /\.(\d+)/.exec(value)?.[1] ?? '';
  return Date.parse(utc) * 1000 + Number(fractional.slice(3, 6).padEnd(3, '0'));
}

export function threadCursor(threadId: string): number {
  return cursors.get(threadId) ?? 0;
}

export function threadRevision(threadId: string): number {
  return revisions.get(threadId) ?? 0;
}

export function beginThreadSnapshot(threadId: string): void {
  pending.set(threadId, []);
}

export function setThreadSnapshotCursor(threadId: string, cursor?: number): void {
  if (cursor !== undefined) cursors.set(threadId, cursor);
}

export function takeThreadSnapshotEvents(threadId: string, cursor?: number): ThreadRuntimeEvent[] {
  const events = pending.get(threadId) ?? [];
  pending.delete(threadId);
  if (cursor !== undefined) cursors.set(threadId, cursor);
  return events;
}

/** Returns false for buffered or already included events. */
export function acceptThreadEvent(threadId: string, event: ThreadRuntimeEvent): boolean {
  const queue = pending.get(threadId);
  if (queue) {
    queue.push(event);
    return false;
  }
  const eventId = Number((event.data as unknown as Record<string, unknown>).event_id ?? 0);
  if (eventId > 0 && eventId <= threadCursor(threadId)) return false;
  if (eventId > 0) cursors.set(threadId, eventId);
  revisions.set(threadId, threadRevision(threadId) + 1);
  return true;
}

export function resetThreadReconciliation(): void {
  generation += 1;
  cursors.clear();
  pending.clear();
  revisions.clear();
}
