import type { ObjectChangedEvent, ProjectSSEEvent, ThreadRuntimeEvent } from '../api/sseClient';
import { ObjectEventConsumer } from './consumers/objectEventConsumer';
import { ThreadEventConsumer } from './consumers/threadEventConsumer';

type EventHandler = (event: ProjectSSEEvent) => Promise<void> | void;

export class EventRouter {
  private readonly objectConsumer: ObjectEventConsumer;
  private readonly threadConsumer: ThreadEventConsumer;
  private readonly routeTable: Record<string, EventHandler>;

  constructor(projectId: string) {
    this.objectConsumer = new ObjectEventConsumer(projectId);
    this.threadConsumer = new ThreadEventConsumer(projectId);
    this.routeTable = {
      'object:changed': (event) => {
        this.objectConsumer.consume(event as ObjectChangedEvent);
      },
    };
  }

  async handleEvent(event: ProjectSSEEvent): Promise<void> {
    const handler = this.routeTable[event.event];
    if (handler) {
      await handler(event);
      return;
    }
    await this.threadConsumer.consume(event as ThreadRuntimeEvent);
  }

  dispose(): void {
    this.objectConsumer.dispose();
    this.threadConsumer.dispose();
  }
}

export default EventRouter;

