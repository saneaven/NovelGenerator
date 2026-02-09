import type { EditCard, ToolCallDecisionMap } from '../../toolCall/types';
import type { ToolCallProgress } from '../../llm/requestTypes';

export type CardMode = 'streaming' | 'pending' | 'confirmed';

export interface ToolCallCardContainerProps {
  mode: CardMode;
  cards?: EditCard[];
  streamingProgress?: ToolCallProgress[];
  onCommitDecisions?: (decisions: ToolCallDecisionMap) => Promise<void>;
  onCommitDecisionsAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
  projectId: string;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}
