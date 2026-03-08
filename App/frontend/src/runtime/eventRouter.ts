import type {
  AssetChangedEvent,
  ImageRunUpdateEvent,
  NotificationSSEEvent,
  ObjectChangedEvent,
  ProjectSSEEvent,
  ThreadRuntimeEvent,
} from '../api/sseClient';
import { AssetEventConsumer } from './consumers/assetEventConsumer';
import { ImageRunEventConsumer } from './consumers/imageRunEventConsumer';
import { ObjectEventConsumer } from './consumers/objectEventConsumer';
import { NotificationEventConsumer } from './consumers/notificationEventConsumer';
import { ThreadEventConsumer } from './consumers/threadEventConsumer';

type EventHandler = (event: ProjectSSEEvent) => Promise<void> | void;

export class EventRouter {
  private readonly assetConsumer: AssetEventConsumer;
  private readonly objectConsumer: ObjectEventConsumer;
  private readonly threadConsumer: ThreadEventConsumer;
  private readonly notificationConsumer: NotificationEventConsumer;
  private readonly imageRunConsumer: ImageRunEventConsumer;
  private readonly routeTable: Record<string, EventHandler>;

  constructor(projectId: string) {
    this.assetConsumer = new AssetEventConsumer(projectId);
    this.objectConsumer = new ObjectEventConsumer(projectId);
    this.threadConsumer = new ThreadEventConsumer(projectId);
    this.notificationConsumer = new NotificationEventConsumer(projectId);
    this.imageRunConsumer = new ImageRunEventConsumer();
    this.routeTable = {
      'asset:changed': (event) => {
        this.assetConsumer.consume(event as AssetChangedEvent);
      },
      'object:changed': (event) => {
        this.objectConsumer.consume(event as ObjectChangedEvent);
      },
      'image_run:update': (event) => {
        this.imageRunConsumer.consume(event as ImageRunUpdateEvent);
      },
      'notification:upsert': (event) => {
        this.notificationConsumer.consume(event as NotificationSSEEvent);
      },
      'notification:delete': (event) => {
        this.notificationConsumer.consume(event as NotificationSSEEvent);
      },
      'notification:bulk_delete': (event) => {
        this.notificationConsumer.consume(event as NotificationSSEEvent);
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
    this.assetConsumer.dispose();
    this.objectConsumer.dispose();
    this.notificationConsumer.dispose();
    this.imageRunConsumer.dispose();
    this.threadConsumer.dispose();
  }
}

export default EventRouter;
