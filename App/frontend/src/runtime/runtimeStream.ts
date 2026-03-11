import { connectProjectStream, type ProjectSSEEvent } from '../api/sseClient';
import { assetService } from '../api/assetService';
import { notificationService } from '../api/notificationService';
import { EventRouter } from './eventRouter';
import { useImageRunStore } from '../imageRun';
import { useAssetStore } from '../store/assetStore';
import { useNotificationStore } from '../store/notificationStore';
import {
  hydrateProjectRuntimeSummary,
  reconcilePreexistingLiveThreads,
  suppressRunningThreadStreaming,
} from './projectRuntimeState';

const STREAM_RECOVERY_ACTIVITY_TIMEOUT_MS = 15_000;
const LIFECYCLE_RECONNECT_DEBOUNCE_MS = 400;

class ProjectRuntimeConnection {
  readonly projectId: string;
  private refCount = 0;
  private abortController: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private readonly router: EventRouter;
  private eventChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private connectionGeneration = 0;
  private reconnectRequested = false;
  private reconnectReason = 'reconnect';
  private lastStreamActivityAt = 0;
  private recoveryAttemptStartedAt: number | null = null;
  private recoveryCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.router = new EventRouter(projectId);
  }

  async start(): Promise<void> {
    this.refCount += 1;
    if (this.streamTask) return;
    if (this.disposed) {
      this.disposed = false;
    }
    this.connect();
  }

  stop(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;

    this.disposed = true;
    this.clearRecoveryCheck();
    this.recoveryAttemptStartedAt = null;
    this.reconnectRequested = false;
    this.reconnectReason = 'reconnect';
    this.abortController?.abort();
    this.abortController = null;
    this.eventChain = Promise.resolve();
    this.router.dispose();
  }

  isIdle(): boolean {
    return this.refCount === 0;
  }

  isActive(): boolean {
    return this.refCount > 0 && !this.disposed;
  }

  forceReconnect(reason: string): void {
    if (!this.isActive()) return;

    const startedAt = Date.now();
    this.recoveryAttemptStartedAt = startedAt;
    this.scheduleRecoveryCheck(startedAt);
    void this.rehydrateRuntimeState(`force:${reason}`);

    if (!this.streamTask) {
      this.connect(`force:${reason}`);
      return;
    }

    this.reconnectRequested = true;
    this.reconnectReason = `force:${reason}`;
    this.abortController?.abort();
  }

  private clearRecoveryCheck(): void {
    if (this.recoveryCheckTimer !== null) {
      clearTimeout(this.recoveryCheckTimer);
      this.recoveryCheckTimer = null;
    }
  }

  private scheduleRecoveryCheck(startedAt: number): void {
    this.clearRecoveryCheck();
    this.recoveryCheckTimer = setTimeout(() => {
      this.recoveryCheckTimer = null;
      if (this.disposed || this.refCount === 0) return;
      if (this.recoveryAttemptStartedAt !== startedAt) return;
      if (this.lastStreamActivityAt > startedAt) {
        this.recoveryAttemptStartedAt = null;
        return;
      }

      const suppressedThreadIds = suppressRunningThreadStreaming(this.projectId);
      if (suppressedThreadIds.length > 0) {
        console.warn('[RuntimeStream] Falling back to suppressed live recovery after inactive reconnect', {
          projectId: this.projectId,
          threadIds: suppressedThreadIds,
        });
      }
      this.recoveryAttemptStartedAt = null;
    }, STREAM_RECOVERY_ACTIVITY_TIMEOUT_MS);
  }

  private markStreamActivity(): void {
    this.lastStreamActivityAt = Date.now();
    if (
      this.recoveryAttemptStartedAt !== null
      && this.lastStreamActivityAt > this.recoveryAttemptStartedAt
    ) {
      this.recoveryAttemptStartedAt = null;
      this.clearRecoveryCheck();
    }
  }

  private async rehydrateRuntimeState(source: string): Promise<void> {
    try {
      const [notificationResponse, runtimeRows, imageRuns] = await Promise.all([
        notificationService.list(this.projectId, {
          limit: 50,
          offset: 0,
          includeRead: true,
        }),
        hydrateProjectRuntimeSummary(this.projectId),
        assetService.listImageRuns(this.projectId, 'active'),
      ]);
      useNotificationStore.getState().hydrate(notificationResponse.items);
      useImageRunStore.getState().upsertRuns(imageRuns);
      await useAssetStore.getState().refreshLoadedCaches(this.projectId);
      await reconcilePreexistingLiveThreads(this.projectId, runtimeRows);
    } catch (error) {
      console.warn('Failed to rehydrate runtime state after SSE reconnect', {
        projectId: this.projectId,
        source,
        error,
      });
    }
  }

  private connect(reason = 'initial'): void {
    if (this.streamTask || this.disposed || this.refCount === 0) return;

    const controller = new AbortController();
    const generation = ++this.connectionGeneration;
    this.abortController = controller;

    const task = connectProjectStream(
      this.projectId,
      (event: ProjectSSEEvent) => {
        this.eventChain = this.eventChain.then(
          () => this.router.handleEvent(event),
        ).catch((err) => {
          console.error('[RuntimeStream] Event handler error', { event: event.event, error: err });
        });
      },
      controller.signal,
      {
        onReconnect: async () => {
          if (this.disposed || this.connectionGeneration !== generation) return;
          await this.rehydrateRuntimeState(`stream-reconnect:${reason}`);
        },
        onActivity: () => {
          if (this.disposed || this.connectionGeneration !== generation) return;
          this.markStreamActivity();
        },
      },
    ).catch((error) => {
      if (controller.signal.aborted || this.disposed) return;
      console.error('Project runtime stream failed', { projectId: this.projectId, reason, error });
    }).finally(() => {
      if (this.abortController === controller) {
        this.abortController = null;
      }
      if (this.streamTask === task) {
        this.streamTask = null;
      }
      if (this.disposed || this.refCount === 0 || !this.reconnectRequested) {
        return;
      }
      this.reconnectRequested = false;
      const nextReason = this.reconnectReason;
      this.reconnectReason = 'reconnect';
      this.connect(nextReason);
    });
    this.streamTask = task;
  }
}

class RuntimeStreamManager {
  private byProject = new Map<string, ProjectRuntimeConnection>();
  private reconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleListenersAttached = false;
  private readonly handleVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    this.scheduleForceReconnectAll('visibilitychange');
  };
  private readonly handlePageShow = () => {
    this.scheduleForceReconnectAll('pageshow');
  };
  private readonly handleWindowFocus = () => {
    this.scheduleForceReconnectAll('focus');
  };
  private readonly handleOnline = () => {
    this.scheduleForceReconnectAll('online');
  };

  private getOrCreate(projectId: string): ProjectRuntimeConnection {
    const existing = this.byProject.get(projectId);
    if (existing) return existing;
    const created = new ProjectRuntimeConnection(projectId);
    this.byProject.set(projectId, created);
    return created;
  }

  private hasActiveConnections(): boolean {
    for (const connection of this.byProject.values()) {
      if (connection.isActive()) return true;
    }
    return false;
  }

  private syncLifecycleListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const shouldAttach = this.hasActiveConnections();
    if (shouldAttach === this.lifecycleListenersAttached) {
      return;
    }

    if (shouldAttach) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('pageshow', this.handlePageShow);
      window.addEventListener('focus', this.handleWindowFocus);
      window.addEventListener('online', this.handleOnline);
      this.lifecycleListenersAttached = true;
      return;
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('focus', this.handleWindowFocus);
    window.removeEventListener('online', this.handleOnline);
    this.lifecycleListenersAttached = false;

    if (this.reconnectDebounceTimer !== null) {
      clearTimeout(this.reconnectDebounceTimer);
      this.reconnectDebounceTimer = null;
    }
  }

  private scheduleForceReconnectAll(reason: string): void {
    if (!this.hasActiveConnections()) return;
    if (this.reconnectDebounceTimer !== null) {
      clearTimeout(this.reconnectDebounceTimer);
    }
    this.reconnectDebounceTimer = setTimeout(() => {
      this.reconnectDebounceTimer = null;
      for (const connection of this.byProject.values()) {
        if (!connection.isActive()) continue;
        connection.forceReconnect(reason);
      }
    }, LIFECYCLE_RECONNECT_DEBOUNCE_MS);
  }

  async start(projectId: string): Promise<void> {
    if (!projectId) return;
    const conn = this.getOrCreate(projectId);
    await conn.start();
    this.syncLifecycleListeners();
  }

  stop(projectId: string): void {
    if (!projectId) return;
    const conn = this.byProject.get(projectId);
    if (!conn) return;
    conn.stop();
    if (conn.isIdle()) {
      this.byProject.delete(projectId);
    }
    this.syncLifecycleListeners();
  }

}

export const runtimeStream = new RuntimeStreamManager();

export async function startProjectRuntime(projectId: string): Promise<void> {
  await runtimeStream.start(projectId);
}

export function stopProjectRuntime(projectId: string): void {
  runtimeStream.stop(projectId);
}

export default runtimeStream;
