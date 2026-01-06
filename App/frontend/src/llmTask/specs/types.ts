import type { TaskKind, TaskSessionState } from '../types';

type BivariantCallback<TArgs extends any[], TResult> = {
  bivarianceHack(...args: TArgs): TResult;
}['bivarianceHack'];

export interface TaskSpecRunContext<TInput, TResult> {
  sessionId: string;
  input: TInput;
  abortController: AbortController;
  updateSession: (partial: Partial<Omit<TaskSessionState<TInput, TResult>, 'id' | 'kind' | 'input'>>) => void;
  setSessionStatus: (status: TaskSessionState<TInput, TResult>['status']) => void;
}

export interface TaskSpec<K extends TaskKind = TaskKind, TInput = unknown, TResult = unknown> {
  kind: K;
  label: BivariantCallback<[TInput], string>;
  run: BivariantCallback<[TaskSpecRunContext<TInput, TResult>], Promise<TResult | void>>;
}
