import type { ContentPart, FunctionCallProgress, TokenUsage } from '../llm/requestTypes';
import type { StoredEditCard } from './uiTypes';

export type TaskKind =
  | 'aiEdit'
  | 'translateObjects'
  | 'agent'
  | 'imagePrompt'
  | 'sceneImage'
  | 'agentTranslation';

export type TaskSessionStatus =
  | 'idle'
  | 'running'
  | 'pending_confirmation'
  | 'applying'
  | 'success'
  | 'error'
  | 'cancelled';

export interface TaskProgress {
  current: number;
  total: number;
  currentItemLabel?: string;
}

export interface TaskSessionState<TInput = unknown, TResult = unknown> {
  id: string;
  kind: TaskKind;
  input: TInput;
  status: TaskSessionStatus;

  label: string;
  createdAt: number;
  updatedAt: number;
  isRead: boolean;

  contentParts: ContentPart[];
  functionCallProgress: FunctionCallProgress[];

  editCards?: StoredEditCard[];

  result?: TResult;
  error?: string;
  warning?: string;

  provider?: string;
  model?: string;
  usage?: TokenUsage;
  progress?: TaskProgress;
}

