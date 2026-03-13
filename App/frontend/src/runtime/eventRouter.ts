import type {
  AssetChangedEvent,
  ImageRunUpdateEvent,
  NotificationSSEEvent,
  ObjectChangedEvent,
  RuntimeSSEEvent,
  ThreadRuntimeEvent,
} from '../api/sseClient';
import { AssetEventConsumer } from './consumers/assetEventConsumer';
import { ImageRunEventConsumer } from './consumers/imageRunEventConsumer';
import { ObjectEventConsumer } from './consumers/objectEventConsumer';
import { NotificationEventConsumer } from './consumers/notificationEventConsumer';
import { ThreadEventConsumer } from './consumers/threadEventConsumer';

type EventHandler = (event: RuntimeSSEEvent) => Promise<void> | void;

export class EventRouter {
  private readonly assetConsumer: AssetEventConsumer;
  private readonly objectConsumer: ObjectEventConsumer;
  private readonly threadConsumer: ThreadEventConsumer;
  private readonly notificationConsumer: NotificationEventConsumer;
  private readonly imageRunConsumer: ImageRunEventConsumer;
  private readonly routeTable: Record<string, EventHandler>;

  constructor() {
    this.assetConsumer = new AssetEventConsumer();
    this.objectConsumer = new ObjectEventConsumer();
    this.threadConsumer = new ThreadEventConsumer();
    this.notificationConsumer = new NotificationEventConsumer();
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

  async handleEvent(event: RuntimeSSEEvent): Promise<void> {
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
