import type { ImageRunUpdateEvent } from '../../api/sseClient';
import { ImageRunRuntime } from '../../imageRun';

export class ImageRunEventConsumer {
  consume(event: ImageRunUpdateEvent): void | Promise<void> {
    return ImageRunRuntime.handleUpdate(event.data);
  }

  dispose(): void {}
}

export default ImageRunEventConsumer;
