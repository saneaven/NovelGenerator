import { connectProjectStream, type ProjectSSEEvent } from '../api/sseClient';
import { notificationService } from '../api/notificationService';
import { EventRouter } from './eventRouter';
import { useNotificationStore } from '../store/notificationStore';

class ProjectRuntimeConnection {
  readonly projectId: string;
  private refCount = 0;
  private abortController: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private readonly router: EventRouter;
  private eventChain: Promise<void> = Promise.resolve();
  private disposed = false;

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
    this.abortController?.abort();
    this.abortController = null;
    this.streamTask = null;
    this.eventChain = Promise.resolve();
    this.router.dispose();
  }

  isIdle(): boolean {
    return this.refCount === 0;
  }

  private connect(): void {
    if (this.streamTask) return;

    this.abortController = new AbortController();
    this.streamTask = connectProjectStream(
      this.projectId,
      (event: ProjectSSEEvent) => {
        this.eventChain = this.eventChain.then(
          () => this.router.handleEvent(event),
        ).catch((err) => {
          console.error('[RuntimeStream] Event handler error', { event: event.event, error: err });
        });
      },
      this.abortController.signal,
      {
        onReconnect: async () => {
          try {
            const response = await notificationService.list(this.projectId, {
              limit: 50,
              offset: 0,
              includeRead: true,
            });
            useNotificationStore.getState().hydrate(response.items);
          } catch (error) {
            console.warn('Failed to rehydrate notifications after SSE reconnect', {
              projectId: this.projectId,
              error,
            });
          }
        },
      },
    ).catch((error) => {
      if (this.abortController?.signal.aborted) return;
      console.error('Project runtime stream failed', { projectId: this.projectId, error });
    }).finally(() => {
      this.streamTask = null;
      this.abortController = null;
    });
  }
}

class RuntimeStreamManager {
  private byProject = new Map<string, ProjectRuntimeConnection>();

  private getOrCreate(projectId: string): ProjectRuntimeConnection {
    const existing = this.byProject.get(projectId);
    if (existing) return existing;
    const created = new ProjectRuntimeConnection(projectId);
    this.byProject.set(projectId, created);
    return created;
  }

  async start(projectId: string): Promise<void> {
    if (!projectId) return;
    const conn = this.getOrCreate(projectId);
    await conn.start();
  }

  stop(projectId: string): void {
    if (!projectId) return;
    const conn = this.byProject.get(projectId);
    if (!conn) return;
    conn.stop();
    if (conn.isIdle()) {
      this.byProject.delete(projectId);
    }
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
