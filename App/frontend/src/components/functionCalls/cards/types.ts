import type { ToolCallDecisionMap } from '../../../toolCall/types';
import type { OperationVM, ObjectOperationVM, SearchOperationVM, CallAgentOperationVM } from '../../../functionCalls/types';

export interface CommonCardProps<T extends OperationVM> {
  threadId: string;
  projectId: string;
  operation: T;
  showDecisionButtons: boolean;
  decisionDisabled?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}

export type ObjectCardProps = CommonCardProps<ObjectOperationVM>;
export type SearchCardProps = CommonCardProps<SearchOperationVM>;
export type CallAgentCardProps = CommonCardProps<CallAgentOperationVM>;

export interface PatchGroupCardProps {
  threadId: string;
  projectId: string;
  groupId: string;
  targetLabel: string;
  operations: ObjectOperationVM[];
  decisionDisabled?: boolean;
  onConfirm: (decisions: ToolCallDecisionMap) => Promise<void>;
  onConfirmAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
}
