import type { ContentPart, ToolCallProgress, ToolCallMetadata, TokenUsage } from '../llm/requestTypes';
import type { StoredEditCard } from './uiTypes';

export type TaskKind =
  | 'aiEdit'
  | 'translateObjects'
  | 'agent'
  | 'subAgent'
  | 'imagePrompt'
  | 'sceneImage'
  | 'agentTranslation'
  | 'agentMemorySummary';

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

  contentParts: ContentPart[];
  toolCallProgress: ToolCallProgress[];
  toolCalls: ToolCallMetadata[];
  thinkingDetails?: any[];

  /** Tool names provided to the model for this session (used for validation). */
  availableToolNames?: string[];

  editCards?: StoredEditCard[];

  result?: TResult;
  error?: string;
  warning?: string;

  provider?: string;
  model?: string;
  usage?: TokenUsage;
  progress?: TaskProgress;
}
