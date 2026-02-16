import type { ThreadInfo } from './store/threadStore';

export function threadPriority(status: ThreadInfo['status']): number {
  switch (status) {
    case 'running':
      return 0;
    case 'waiting_tools':
      return 1;
    case 'paused':
      return 2;
    case 'error':
      return 3;
    case 'idle':
      return 4;
    default:
      return 5;
  }
}

export function isBlockingThreadStatus(status: ThreadInfo['status']): boolean {
  return status === 'running' || status === 'waiting_tools' || status === 'paused' || status === 'error';
}
