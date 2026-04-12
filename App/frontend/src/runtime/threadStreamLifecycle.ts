import type { ThreadStatus } from '../types/thread';

export function isLiveThreadStatus(status: ThreadStatus | null | undefined): boolean {
  return status === 'running';
}

export function isNonLiveThreadStatus(status: ThreadStatus | null | undefined): boolean {
  return status === 'waiting'
    || status === 'ready'
    || status === 'paused'
    || status === 'done'
    || status === 'error'
    || status === 'canceled';
}

export function shouldMarkAsPreexistingLive(status: ThreadStatus | null | undefined): boolean {
  return isLiveThreadStatus(status);
}
