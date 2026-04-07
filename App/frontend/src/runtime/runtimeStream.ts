import { assetService } from '../api/assetService';
import { connectUserStream, type RuntimeSSEEvent } from '../api/sseClient';
import { notificationService } from '../api/notificationService';
import { useImageRunStore } from '../imageRun';
import { useNotificationStore } from '../store/notificationStore';
import { useProjectStore } from '../store/projectStore';
import { useAssetStore } from '../store/assetStore';
import { EventRouter } from './eventRouter';
import {
  hydrateProjectRuntimeSummary,
  reconcilePreexistingLiveThreads,
} from './projectRuntimeState';

const STREAM_RECOVERY_ACTIVITY_TIMEOUT_MS = 15_000;
const LIFECYCLE_RECONNECT_DEBOUNCE_MS = 400;

class UserRuntimeConnection {
  private refCount = 0;
  private abortController: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private router: EventRouter | null = null;
  private eventChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private connectionGeneration = 0;
  private reconnectRequested = false;
  private reconnectReason = 'reconnect';
  private lastStreamActivityAt = 0;
  private recoveryAttemptStartedAt: number | null = null;
  private recoveryCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private rehydrationInFlight: Promise<void> | null = null;
  private rehydrationTriggeredByForce = false;

  async start(): Promise<void> {
    this.refCount += 1;
    if (this.streamTask) return;
    this.disposed = false;
    if (this.router === null) {
      this.router = new EventRouter();
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
    this.streamTask = null;
    this.eventChain = Promise.resolve();
    this.router?.dispose();
    this.router = null;
  }

  isActive(): boolean {
    return this.refCount > 0 && !this.disposed;
  }

  forceReconnect(reason: string): void {
    if (!this.isActive()) return;

    const startedAt = Date.now();
    this.recoveryAttemptStartedAt = startedAt;
    this.scheduleRecoveryCheck(startedAt);
    this.rehydrationTriggeredByForce = true;
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

  private rehydrateRuntimeState(source: string): Promise<void> {
    if (this.rehydrationInFlight) {
      return this.rehydrationInFlight;
    }

    const task = this.doRehydrateRuntimeState(source).finally(() => {
      this.rehydrationInFlight = null;
    });
    this.rehydrationInFlight = task;
    return task;
  }

  private async doRehydrateRuntimeState(source: string): Promise<void> {
    const currentProjectId = useProjectStore.getState().currentProjectId;

    try {
      const notificationResponse = await notificationService.list({
        limit: 50,
        offset: 0,
        includeRead: true,
      });
      useNotificationStore.getState().hydrate(notificationResponse.items);

      if (!currentProjectId) {
        return;
      }

      const [runtimeRows, imageRuns] = await Promise.all([
        hydrateProjectRuntimeSummary(currentProjectId),
        assetService.listImageRuns(currentProjectId, 'active'),
        useAssetStore.getState().refreshLoadedCaches(currentProjectId),
      ]).then(([rows, runs]) => [rows, runs] as const);
      useImageRunStore.getState().upsertRuns(imageRuns);
      await reconcilePreexistingLiveThreads(currentProjectId, runtimeRows);
    } catch (error) {
      console.warn('Failed to rehydrate runtime state after SSE reconnect', {
        currentProjectId,
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

    const task = connectUserStream(
      (event: RuntimeSSEEvent) => {
        const router = this.router;
        if (!router) return;
        this.eventChain = this.eventChain.then(
          () => router.handleEvent(event),
        ).catch((err) => {
          console.error('[RuntimeStream] Event handler error', { event: event.event, error: err });
        });
      },
      controller.signal,
      {
        onReconnect: async () => {
          if (this.disposed || this.connectionGeneration !== generation) return;
          if (this.rehydrationTriggeredByForce) {
            this.rehydrationTriggeredByForce = false;
            return;
          }
          await this.rehydrateRuntimeState(`stream-reconnect:${reason}`);
        },
        onActivity: () => {
          if (this.disposed || this.connectionGeneration !== generation) return;
          this.markStreamActivity();
        },
      },
    ).catch((error) => {
      if (controller.signal.aborted || this.disposed) return;
      console.error('User runtime stream failed', { reason, error });
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
  private readonly connection = new UserRuntimeConnection();
  private reconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleListenersAttached = false;

  private readonly handleVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    this.scheduleForceReconnect('visibilitychange');
  };

  private readonly handlePageShow = () => {
    this.scheduleForceReconnect('pageshow');
  };

  private readonly handleWindowFocus = () => {
    this.scheduleForceReconnect('focus');
  };

  private readonly handleOnline = () => {
    this.scheduleForceReconnect('online');
  };

  private syncLifecycleListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const shouldAttach = this.connection.isActive();
    if (shouldAttach === this.lifecycleListenersAttached) return;

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

  private scheduleForceReconnect(reason: string): void {
    if (!this.connection.isActive()) return;
    if (this.reconnectDebounceTimer !== null) {
      clearTimeout(this.reconnectDebounceTimer);
    }
    this.reconnectDebounceTimer = setTimeout(() => {
      this.reconnectDebounceTimer = null;
      if (!this.connection.isActive()) return;
      this.connection.forceReconnect(reason);
    }, LIFECYCLE_RECONNECT_DEBOUNCE_MS);
  }

  async start(): Promise<void> {
    await this.connection.start();
    this.syncLifecycleListeners();
  }

  stop(): void {
    this.connection.stop();
    this.syncLifecycleListeners();
  }
}

export const runtimeStream = new RuntimeStreamManager();

export async function startUserRuntime(): Promise<void> {
  await runtimeStream.start();
}

export function stopUserRuntime(): void {
  runtimeStream.stop();
}

export async function startProjectRuntime(_projectId: string): Promise<void> {
  // Deprecated: runtime is now user-scoped and started from ProtectedLayout.
}

export function stopProjectRuntime(_projectId: string): void {
  // Deprecated: runtime is now user-scoped and stopped on logout/layout unmount.
}

export default runtimeStream;
