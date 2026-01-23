import type { EditCard } from '../../toolCall/types';
import type { ToolCallProgress } from '../../llm/requestTypes';

export type CardMode = 'streaming' | 'pending' | 'confirmed';

export interface ToolCallCardContainerProps {
  mode: CardMode;
  cards?: EditCard[];
  streamingProgress?: ToolCallProgress[];
  onConfirm?: (selections: Record<string, boolean>) => Promise<void>;
  onConfirmAndPause?: (selections: Record<string, boolean>) => Promise<void>;
  projectId: string;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}
