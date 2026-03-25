import type { ApplicationResult, ToolCallStatus } from '../types';

export type OperationCategory =
  | 'read'
  | 'create'
  | 'replace'
  | 'patch'
  | 'delete'
  | 'translate'
  | 'patch_translation'
  | 'search'
  | 'call'
  | 'generate'
  | 'get'
  | 'mcp';

export type ObjectType =
  | 'story_entity_folder'
  | 'story_entity'
  | 'basic_info'
  | 'guidelines'
  | 'outline'
  | 'manuscript'
  | 'timeline_track'
  | 'timeline_event';

export type SearchType = 'semantic' | 'keyword';

export type StoryEntityKind = 'character' | 'location' | 'organization' | 'lorebook';
export type OutlineKind = 'outline' | 'act' | 'chapter';

export type HeaderStatus =
  | 'collecting'
  | 'validating'
  | 'pending'
  | 'processing'
  | 'working'
  | 'streaming'
  | 'applied'
  | 'rejected'
  | 'failed';

export type PatchDecision = 'accept' | 'reject';

export interface OperationBaseVM {
  id: string;
  toolName: string;
  status: HeaderStatus;
  extraContent?: Record<string, unknown> | null;
  imageRunId?: string | null;
  reason?: string;
  result?: ApplicationResult;
  args: Record<string, unknown>;
  title: string;
  targetId?: string;
  targetLabel?: string;
  decisionEligible: boolean;
  includeInBulkDecision: boolean;
  isValidationFailure: boolean;
  isRunning: boolean;
}

export interface ObjectOperationVM extends OperationBaseVM {
  category: Exclude<OperationCategory, 'search' | 'call' | 'generate'>;
  objectType: ObjectType;
  storyEntityKind?: StoryEntityKind;
  outlineKind?: OutlineKind;
}

export interface SearchOperationVM extends OperationBaseVM {
  category: 'search';
  searchType: SearchType;
}

export interface CallOperationVM extends OperationBaseVM {
  category: 'call';
  agentName: string;
  displayName: string;
  input: string;
}

export interface GenerateOperationVM extends OperationBaseVM {
  category: 'generate';
  imageKind: 'object' | 'scene';
  prompt: string;
  requestedRatio: string;
  isUserRejectedFailure: boolean;
}

export type OperationVM =
  | ObjectOperationVM
  | SearchOperationVM
  | CallOperationVM
  | GenerateOperationVM;

export type OperationSource = 'stored' | 'streaming';

export interface OperationBuildContext {
  source: OperationSource;
}

export const DECISION_ELIGIBLE_STATUSES: ReadonlySet<HeaderStatus | ToolCallStatus> = new Set([
  'pending',
  'validating',
]);

export const BLOCKING_STATUSES: ReadonlySet<HeaderStatus | ToolCallStatus> = new Set([
  'pending',
  'validating',
  'processing',
  'working',
  'streaming',
]);

export const STREAMING_STATUSES: ReadonlySet<HeaderStatus> = new Set([
  'collecting',
  'validating',
  'processing',
  'working',
  'streaming',
]);
