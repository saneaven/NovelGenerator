import type { ToolCallDecisionMap } from '../../types';
import type {
  OperationVM,
  ObjectOperationVM,
  SearchOperationVM,
  CallAgentOperationVM,
  ImageOperationVM,
} from '../vmTypes';

export interface CommonCardProps<T extends OperationVM> {
  threadId: string;
  scopeKey: string;
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
export type ImageCardProps = CommonCardProps<ImageOperationVM>;

export interface PatchGroupCardProps {
  scopeKey: string;
  projectId: string;
  groupId: string;
  targetLabel: string;
  operations: ObjectOperationVM[];
  decisionDisabled?: boolean;
  onConfirm: (decisions: ToolCallDecisionMap) => Promise<void>;
  onConfirmAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
}
