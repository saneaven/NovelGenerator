import type { ApplicationResult, ToolCallStatus } from '../types';

export type OperationCategory =
  | 'read'
  | 'create'
  | 'replace'
  | 'patch'
  | 'delete'
  | 'search'
  | 'call_agent'
  | 'image';

export type ObjectType =
  | 'story_object'
  | 'basic_info'
  | 'guidelines'
  | 'outline'
  | 'outline_act'
  | 'outline_chapter'
  | 'manuscript';

export type SearchType = 'rag' | 'keyword';

export type StoryObjectSubtype = 'character' | 'location' | 'organization' | 'lorebook';

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
  category: Exclude<OperationCategory, 'search' | 'call_agent'>;
  objectType: ObjectType;
  storySubtype?: StoryObjectSubtype;
}

export interface SearchOperationVM extends OperationBaseVM {
  category: 'search';
  searchType: SearchType;
}

export interface CallAgentOperationVM extends OperationBaseVM {
  category: 'call_agent';
  agentName: string;
  displayName: string;
  input: string;
}

export interface ImageOperationVM extends OperationBaseVM {
  category: 'image';
  imageKind: 'object' | 'scene';
  imageState: 'generating' | 'generated';
  prompt: string;
  requestedRatio: string;
  resolvedRatio?: string;
  resolvedSize?: string;
  provider?: string;
  model?: string;
  previewAssetId?: string;
  previewAssetUrl?: string;
  objectType?: string;
  beforeExcerpt?: string;
  afterExcerpt?: string;
  failureCode?: string;
  isUserRejectedFailure: boolean;
}

export type OperationVM =
  | ObjectOperationVM
  | SearchOperationVM
  | CallAgentOperationVM
  | ImageOperationVM;

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
