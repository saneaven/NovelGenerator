import type { ReactElement } from 'react';
import type { ApplicationResult, ToolCallFailureType } from '../types';
import {
  DECISION_ELIGIBLE_STATUSES,
  type HeaderStatus,
  type OperationBaseVM,
  type OperationSource,
  type OperationVM,
} from '../ui/vmTypes';

export type AutoApproveCategory = 'read' | 'search' | 'create' | 'delete' | 'replace' | 'patch' | 'subAgent';

export interface MapToolToVmParams {
  id: string;
  toolName: string;
  args?: unknown;
  extraContent?: Record<string, unknown> | null;
  imageRunId?: string | null;
  status?: string;
  reason?: string;
  failureType?: ToolCallFailureType;
  result?: unknown;
  source: OperationSource;
}

export interface RenderCardParams {
  threadId: string;
  scopeKey: string;
  projectId: string;
  operation: OperationVM;
  showDecisionButtons: boolean;
  decisionDisabled: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}

export interface ToolUiSpec {
  id: string;
  match(toolName: string): boolean;
  toOperationVM(params: MapToolToVmParams): OperationVM;
  renderCard(params: RenderCardParams): ReactElement | null;
  getEditTitle(toolName: string, args: Record<string, unknown>): string;
  getEditType(toolName: string): string;
  getAutoApproveCategory(toolName: string): AutoApproveCategory | null;
}

export function coerceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function toApplicationResult(raw: unknown): ApplicationResult | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    success: Boolean(r.success ?? true),
    message: typeof r.message === 'string' ? r.message : '',
    error: typeof r.error === 'string' ? r.error : undefined,
    objectId: typeof r.objectId === 'string' ? r.objectId : undefined,
    objectType: typeof r.objectType === 'string' ? r.objectType : undefined,
    data:
      r.data && typeof r.data === 'object' && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : undefined,
  };
}

function normalizeStoredStatus(status?: string): HeaderStatus {
  switch (status) {
    case 'streaming':
    case 'validating':
    case 'pending':
    case 'processing':
    case 'working':
    case 'failed':
    case 'applied':
    case 'rejected':
      return status;
    case 'running':
      return 'streaming';
    case 'accepted':
      return 'applied';
    case undefined:
      return 'pending';
    default:
      return 'pending';
  }
}

function normalizeStreamingStatus(status?: string): HeaderStatus {
  switch (status) {
    case 'collecting':
      return 'collecting';
    case 'validating':
      return 'validating';
    case 'ready':
      return 'pending';
    case 'error':
      return 'failed';
    default:
      return 'collecting';
  }
}

export function normalizeStatus(status: string | undefined, source: OperationSource): HeaderStatus {
  return source === 'streaming' ? normalizeStreamingStatus(status) : normalizeStoredStatus(status);
}

export function buildOperationBase(
  params: MapToolToVmParams,
  title: string,
  targetId?: string,
  targetLabel?: string,
): OperationBaseVM {
  const args = coerceRecord(params.args);
  const status = normalizeStatus(params.status, params.source);
  const reason = typeof params.reason === 'string' ? params.reason : undefined;
  const result = toApplicationResult(params.result);

  return {
    id: params.id,
    toolName: params.toolName,
    status,
    extraContent: params.extraContent ?? null,
    imageRunId: params.imageRunId ?? null,
    reason,
    result,
    args,
    title,
    targetId,
    targetLabel,
    decisionEligible: DECISION_ELIGIBLE_STATUSES.has(status),
    includeInBulkDecision: true,
    isValidationFailure: status === 'failed' && params.failureType === 'validation',
    isRunning: status === 'collecting' || status === 'streaming' || status === 'processing' || status === 'working',
  };
}
