import type { EditCard } from '../../functionCall/types';
import type { FunctionCallProgress } from '../../llm/requestTypes';

export type CardMode = 'streaming' | 'pending' | 'confirmed';

export interface FunctionCallCardContainerProps {
  mode: CardMode;
  cards?: EditCard[];
  streamingProgress?: FunctionCallProgress[];
  onConfirm?: (selections: Record<string, boolean>) => Promise<void>;
  onConfirmAndPause?: (selections: Record<string, boolean>) => Promise<void>;
  projectId: string;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}
