import { unifiedObjectService } from '../../api/unifiedObjectService';
import { useSelectionStore } from '../../store/selectionStore';
import { readSettingsFromCache } from '../../data/settings';
import type { ObjectChangedEvent } from '../../api/sseClient';
import { defaultRichTextFormatForType, isRichPreviewType } from '../../domain/objectFormat';
import {
  markObjectStaleFromSSE,
  removeObjectFromCacheFromSSE,
  writeObjectToCacheFromSSE,
  type ObjectChangeAction,
} from '../../data/sse/sseObjectBridge';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

const FLUSH_DEBOUNCE_MS = 50;

const OBJECT_TYPE_SET: ReadonlySet<ObjectType> = new Set([
  'basic_info',
  'guidelines',
  'story_entity_folder',
  'story_entity',
  'outline',
  'manuscript',
  'timeline_track',
  'timeline_event',
]);

type PendingUpsert = {
  projectId: string;
  objectType: ObjectType;
  objectId: string;
  revision: number;
  action: Extract<ObjectChangeAction, 'created' | 'updated'>;
};

type PendingDelete = {
  projectId: string;
  objectType: ObjectType;
  objectId: string;
  action: Extract<ObjectChangeAction, 'deleted'>;
};

export class ObjectEventConsumer {
  private readonly pendingDeletes = new Map<string, PendingDelete>();
  private readonly pendingDeleteKeys = new Set<string>();
  private readonly pendingUpserts = new Map<string, PendingUpsert>();
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
    this.pendingDeletes.clear();
    this.pendingDeleteKeys.clear();
    this.pendingUpserts.clear();
    this.revisionByKey.clear();
  }

  consume(event: ObjectChangedEvent): void {
    if (this.disposed) return;
    const payload = event.data;
    const projectId = String(payload?.project_id ?? '');
    const currentProjectId = useSelectionStore.getState().currentProjectId;
    if (!payload || !projectId || currentProjectId !== projectId) return;
    if (!Array.isArray(payload.changes) || payload.changes.length === 0) return;

    for (const change of payload.changes) {
      const action = String(change?.action ?? '').toLowerCase();
      const objectId = String(change?.object_id ?? '');
      const objectTypeRaw = change?.object_type;
      if (!objectId) continue;

      if (!this.isObjectType(objectTypeRaw)) continue;

      const objectType = objectTypeRaw;
      const key = this.objectKey(objectType, objectId);
      this.bumpRevision(key);

      if (action === 'deleted') {
        this.pendingDeletes.set(key, { projectId, objectType, objectId, action });
        this.pendingDeleteKeys.add(key);
        this.pendingUpserts.delete(key);
        continue;
      }

      if (action === 'created' || action === 'updated') {
        if (this.pendingDeleteKeys.has(key)) continue;
        this.pendingUpserts.set(key, {
          projectId,
          objectType,
          objectId,
          action,
          revision: this.revisionByKey.get(key) ?? 0,
        });
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
    const deletes = [...this.pendingDeletes.values()];
    const deleteKeys = new Set(this.pendingDeleteKeys);
    const upserts = [...this.pendingUpserts.values()];

    this.pendingDeletes.clear();
    this.pendingDeleteKeys.clear();
    this.pendingUpserts.clear();

    if (!deletes.length && !upserts.length) return;

    const settings = readSettingsFromCache();
    const preferredDisplayLanguage = useSelectionStore.getState().preferredDisplayLanguage;
    const language = preferredDisplayLanguage || settings?.mainLanguage || 'English';
    const validUpserts = upserts.filter((item) => this.isCurrentUpsert(item, deleteKeys));

    await Promise.all(
      [
        ...deletes.map((item) =>
          removeObjectFromCacheFromSSE({
            type: item.objectType,
            id: item.objectId,
            projectId: item.projectId,
          }),
        ),
        ...validUpserts.map((item) => this.fetchAndWriteUpsert(item, language, deleteKeys)),
      ],
    );
  }

  private isCurrentUpsert(item: PendingUpsert, deleteKeys: ReadonlySet<string>): boolean {
    const key = this.objectKey(item.objectType, item.objectId);
    const latestRevision = this.revisionByKey.get(key) ?? 0;
    return latestRevision === item.revision && !deleteKeys.has(key) && !this.pendingDeleteKeys.has(key);
  }

  private async fetchAndWriteUpsert(
    item: PendingUpsert,
    language: string,
    deleteKeys: ReadonlySet<string>,
  ): Promise<void> {
    const format = defaultRichTextFormatForType(item.objectType);

    try {
      const [object, markdownObject] = await Promise.all([
        unifiedObjectService.getObject(item.objectType, item.objectId, language, format),
        isRichPreviewType(item.objectType)
          ? unifiedObjectService.getObject(item.objectType, item.objectId, language, 'markdown')
          : Promise.resolve(null),
      ]);

      if (!this.isCurrentUpsert(item, deleteKeys)) return;

      await writeObjectToCacheFromSSE(
        object as UnifiedObject,
        markdownObject as UnifiedObject | null,
        language,
        item.action,
        format,
      );
    } catch (error) {
      if (!this.isCurrentUpsert(item, deleteKeys)) return;
      console.warn('Failed to fetch changed object from SSE event', {
        projectId: item.projectId,
        objectType: item.objectType,
        objectId: item.objectId,
        error,
      });
      await markObjectStaleFromSSE({
        type: item.objectType,
        id: item.objectId,
        projectId: item.projectId,
      });
    }
  }
}
