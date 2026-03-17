import { unifiedObjectService } from '../../api/unifiedObjectService';
import { useProjectStore } from '../../store/projectStore';
import { useStoryEntityFolderStore } from '../../store/storyEntityFolderStore';
import type { ObjectChangedEvent } from '../../api/sseClient';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

const FLUSH_DEBOUNCE_MS = 50;

const OBJECT_TYPE_SET: ReadonlySet<ObjectType> = new Set([
  'basic_info',
  'guidelines',
  'story_entity_folder',
  'story_entity',
  'outline',
  'manuscript',
]);

type PendingUpsert = {
  projectId: string;
  objectType: ObjectType;
  objectId: string;
  revision: number;
};

export class ObjectEventConsumer {
  private readonly pendingDeleteIds = new Set<string>();
  private readonly pendingDeleteKeys = new Set<string>();
  private readonly pendingUpserts = new Map<string, PendingUpsert>();
  private readonly pendingFolderRefreshProjectIds = new Set<string>();
  private readonly revisionByKey = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor() {}

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingDeleteIds.clear();
    this.pendingDeleteKeys.clear();
    this.pendingUpserts.clear();
    this.pendingFolderRefreshProjectIds.clear();
    this.revisionByKey.clear();
  }

  consume(event: ObjectChangedEvent): void {
    if (this.disposed) return;
    const payload = event.data;
    const projectId = String(payload?.project_id ?? '');
    const currentProjectId = useProjectStore.getState().currentProjectId;
    if (!payload || !projectId || currentProjectId !== projectId) return;
    if (!Array.isArray(payload.changes) || payload.changes.length === 0) return;

    for (const change of payload.changes) {
      const action = String(change?.action ?? '').toLowerCase();
      const objectId = String(change?.object_id ?? '');
      const objectTypeRaw = change?.object_type;
      if (!objectId || !this.isObjectType(objectTypeRaw)) continue;

      const objectType = objectTypeRaw;
      if (objectType === 'story_entity_folder') {
        this.pendingFolderRefreshProjectIds.add(projectId);
        continue;
      }
      const key = this.objectKey(objectType, objectId);
      const revision = this.bumpRevision(key);

      if (action === 'deleted') {
        this.pendingDeleteIds.add(objectId);
        this.pendingDeleteKeys.add(key);
        this.pendingUpserts.delete(key);
        continue;
      }

      if (action === 'created' || action === 'updated') {
        if (this.pendingDeleteKeys.has(key)) continue;
        this.pendingUpserts.set(key, { projectId, objectType, objectId, revision });
      }
    }

    this.scheduleFlush();
  }

  private objectKey(objectType: ObjectType, objectId: string): string {
    return `${objectType}:${objectId}`;
  }

  private isObjectType(value: unknown): value is ObjectType {
    return typeof value === 'string' && OBJECT_TYPE_SET.has(value as ObjectType);
  }

  private bumpRevision(key: string): number {
    const next = (this.revisionByKey.get(key) ?? 0) + 1;
    this.revisionByKey.set(key, next);
    return next;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    if (this.disposed) return;
    const deletes = [...this.pendingDeleteIds];
    const deleteKeys = new Set(this.pendingDeleteKeys);
    const upserts = [...this.pendingUpserts.values()];
    const folderRefreshProjectIds = [...this.pendingFolderRefreshProjectIds];

    this.pendingDeleteIds.clear();
    this.pendingDeleteKeys.clear();
    this.pendingUpserts.clear();
    this.pendingFolderRefreshProjectIds.clear();

    if (!deletes.length && !upserts.length && !folderRefreshProjectIds.length) return;

    if (deletes.length > 0) {
      useUnifiedObjectStore.getState().applyObjectChanges({ deletes });
    }
    if (folderRefreshProjectIds.length > 0) {
      await Promise.all(
        folderRefreshProjectIds.map(async (projectId) => {
          try {
            await useStoryEntityFolderStore.getState().fetchFolders(projectId);
          } catch (error) {
            console.warn('Failed to refresh story entity folders from SSE event', {
              projectId,
              error,
            });
          }
        }),
      );
    }
    if (upserts.length === 0) return;

    const fetched: UnifiedObject[] = [];
    await Promise.all(
      upserts.map(async (item) => {
        const key = this.objectKey(item.objectType, item.objectId);
        try {
          const object = await unifiedObjectService.getObject(item.objectType, item.objectId);
          const latestRevision = this.revisionByKey.get(key) ?? 0;
          if (latestRevision !== item.revision) return;
          if (deleteKeys.has(key) || this.pendingDeleteKeys.has(key)) return;
          fetched.push(object);
        } catch (error) {
          console.warn('Failed to fetch changed object from SSE event', {
            projectId: item.projectId,
            objectType: item.objectType,
            objectId: item.objectId,
            error,
          });
        }
      }),
    );

    if (fetched.length > 0) {
      useUnifiedObjectStore.getState().applyObjectChanges({ upserts: fetched });
    }
  }
}

