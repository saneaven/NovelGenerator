import type { EditCard } from '../../functionCall/types';
import type { FunctionCallOperationPreview, FunctionCallProgress } from '../../llm/requestTypes';
import type { StoryObjects } from '../../types/storyObject';
import type { SimplifiedStoryObjects } from '../../store/unifiedObjectStore';

export type CardMode = 'streaming' | 'pending' | 'confirmed';

/** Union type that accepts both StoryObjects and SimplifiedStoryObjects */
export type StoryObjectsLike = StoryObjects | SimplifiedStoryObjects;

export interface FunctionCallCardContainerProps {
  mode: CardMode;
  cards?: EditCard[];
  streamingProgress?: FunctionCallProgress[];
  onConfirm?: (selections: Record<string, boolean>) => Promise<void>;
  projectId: string;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}

export interface CardWithPreview {
  card: EditCard;
  previews: FunctionCallOperationPreview[];
}

export interface StreamingPreview {
  progress: FunctionCallProgress;
  functionName: string;
  previews: FunctionCallOperationPreview[];
}

export interface SelectionState {
  selections: Record<string, boolean>;
  selectedCount: number;
  rejectedCount: number;
  toggleSelection: (cardId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
}
