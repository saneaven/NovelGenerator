import type { ToolCallDecisionMap } from '../../types';
import type {
  OperationVM,
  ObjectOperationVM,
  SearchOperationVM,
  CallOperationVM,
  GenerateOperationVM,
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
export type CallAgentCardProps = CommonCardProps<CallOperationVM>;
export type ImageCardProps = CommonCardProps<GenerateOperationVM>;

export interface PatchMetaChange {
  label: string;
  value: string;
}

export interface PatchGroupCardProps {
  scopeKey: string;
  projectId: string;
  groupId: string;
  targetLabel: string;
  operations: ObjectOperationVM[];
  category: 'patch' | 'patch_translation';
  decisionDisabled?: boolean;
  onConfirm: (decisions: ToolCallDecisionMap) => Promise<void>;
  onConfirmAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
  /** Optional CSS color for a left accent (e.g. timeline track color). */
  accentColor?: string;
  /** Optional metadata-change chips shown above the text diffs. */
  metaChanges?: PatchMetaChange[];
}
