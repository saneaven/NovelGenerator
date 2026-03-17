import type { AssetChangedChange, AssetChangedEvent } from '../../api/sseClient';
import { useProjectStore } from '../../store/projectStore';
import { useAssetStore } from '../../store/assetStore';

const FLUSH_DEBOUNCE_MS = 50;
const SCENE_ALL_KEY = '__all__';

const getObjectKey = (objectType: string, objectId: string) => `${objectType}:${objectId}`;
const getSceneKey = (manuscriptId: string | null) => manuscriptId ?? SCENE_ALL_KEY;

type PendingObjectRef = {
  objectType: string;
  objectId: string;
};

export class AssetEventConsumer {
  private activeProjectId: string | null = null;
  private pendingProjectAssets = false;
  private readonly pendingObjectAssetKeys = new Map<string, PendingObjectRef>();
  private readonly pendingSceneKeys = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingProjectAssets = false;
    this.activeProjectId = null;
    this.pendingObjectAssetKeys.clear();
    this.pendingSceneKeys.clear();
  }

  consume(event: AssetChangedEvent): void {
    if (this.disposed) return;
    const payload = event.data;
    const projectId = String(payload?.project_id ?? '');
    const currentProjectId = useProjectStore.getState().currentProjectId;
    if (!payload || !projectId || currentProjectId !== projectId) return;
    this.activeProjectId = projectId;
    if (!Array.isArray(payload.changes) || payload.changes.length === 0) return;

    for (const change of payload.changes) {
      this.trackChange(change);
    }

    this.scheduleFlush();
  }

  private trackChange(change: AssetChangedChange): void {
    if (change.scope === 'project_assets') {
      this.pendingProjectAssets = true;
      return;
    }

    if (change.scope === 'object_asset_links') {
      const objectType = String(change.object_type ?? '').trim();
      const objectId = String(change.object_id ?? '').trim();
      if (!objectType || !objectId) return;
      this.pendingObjectAssetKeys.set(
        getObjectKey(objectType, objectId),
        { objectType, objectId },
      );
      return;
    }

    this.pendingSceneKeys.add(getSceneKey(change.manuscript_id ?? null));
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
    const projectId = this.activeProjectId;
    if (!projectId) return;

    const shouldRefreshProjectAssets = this.pendingProjectAssets;
    const objectAssetKeys = [...this.pendingObjectAssetKeys.values()];
    const sceneKeys = [...this.pendingSceneKeys];

    this.pendingProjectAssets = false;
    this.pendingObjectAssetKeys.clear();
    this.pendingSceneKeys.clear();

    const store = useAssetStore.getState();
    const tasks: Promise<void>[] = [];

    if (shouldRefreshProjectAssets && store.isProjectAssetsLoaded(projectId)) {
      tasks.push(store.fetchAssets(projectId, true));
    }

    for (const item of objectAssetKeys) {
      if (!store.isObjectAssetLinksLoaded(projectId, item.objectType, item.objectId)) continue;
      tasks.push(store.fetchObjectAssetLinks(projectId, item.objectType, item.objectId, true));
    }

    for (const sceneKey of sceneKeys) {
      const manuscriptId = sceneKey === SCENE_ALL_KEY ? undefined : sceneKey;
      if (!store.isSceneAssetsLoaded(projectId, manuscriptId)) continue;
      tasks.push(store.fetchSceneAssets(projectId, manuscriptId, true));
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }
}

export default AssetEventConsumer;
