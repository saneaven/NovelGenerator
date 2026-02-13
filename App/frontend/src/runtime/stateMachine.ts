import type { RunStatus } from './types';

export type RunStatusTransitionMap = Record<RunStatus, RunStatus[]>;

export const ALLOWED_RUN_STATUS_TRANSITIONS: RunStatusTransitionMap = {
  running: ['waiting', 'paused', 'error', 'completed', 'cancelled'],
  waiting: ['running', 'paused', 'cancelled', 'completed'],
  paused: ['running', 'cancelled'],
  error: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['completed', 'cancelled']);

export function canTransitionRunStatus(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return true;
  if (TERMINAL_RUN_STATUSES.has(from)) return false;
  return ALLOWED_RUN_STATUS_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRunStatus(from, to)) {
    throw new Error(`Invalid run transition: ${from} -> ${to}`);
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}
