import type { TaskKind } from '../types';
import type { TaskSpec } from './types';

/**
 * Task spec registry (single source of truth).
 *
 * NOTE: Specs are registered in `taskSpecs.ts` to avoid circular imports.
 */
let taskSpecs: Partial<Record<TaskKind, TaskSpec>> = {};

export function registerTaskSpecs(specs: Partial<Record<TaskKind, TaskSpec>>): void {
  taskSpecs = { ...taskSpecs, ...specs };
}

export function getTaskSpec(kind: TaskKind): TaskSpec {
  const spec = taskSpecs[kind];
  if (!spec) {
    throw new Error(`No TaskSpec registered for kind: ${kind}`);
  }
  return spec;
}

