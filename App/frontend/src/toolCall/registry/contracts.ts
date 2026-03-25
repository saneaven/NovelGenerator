import type { ReactElement } from 'react';
import type { ApplicationResult, ToolCallFailureType } from '../types';
import type { ToolCallDecisionMap } from '../types';
import {
  DECISION_ELIGIBLE_STATUSES,
  type HeaderStatus,
  type OperationBaseVM,
  type OperationSource,
  type OperationVM,
} from '../ui/vmTypes';

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

export interface DecisionRenderProps {
  showDecisionButtons: boolean;
  decisionDisabled: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}

export interface RenderContext {
  threadId: string;
  scopeKey: string;
  projectId: string;
  getDecisionProps: (operation: OperationVM) => DecisionRenderProps;
  onCommitDecisions: (decisions: ToolCallDecisionMap) => Promise<void>;
  onCommitDecisionsAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
}

export interface RenderItem {
  id: string;
  operationIds: string[];
  element: ReactElement | null;
}

export interface ToolCallUiModule {
  key: string;
  toolNames?: readonly string[];
  matches?: (toolName: string) => boolean;
  mapOperation(params: MapToolToVmParams): OperationVM;
  buildRenderItems(operations: OperationVM[], ctx: RenderContext): RenderItem[];
  getEditMeta(toolName: string, args: Record<string, unknown>): { title: string; type: string };
}

type ToolCallUiModuleInput = ToolCallUiModule;

export function defineToolCallUiModule(module: ToolCallUiModuleInput): ToolCallUiModule {
  return module;
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

function resolveStoredStatus(status?: string): HeaderStatus {
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
    case undefined:
      return 'pending';
    default:
      throw new Error(`Unsupported stored tool status: ${status}`);
  }
}

function resolveStreamingStatus(status?: string): HeaderStatus {
  switch (status) {
    case 'collecting':
      return 'collecting';
    case 'validating':
      return 'validating';
    case 'ready':
      return 'pending';
    case 'error':
      return 'failed';
    case undefined:
      return 'collecting';
    default:
      throw new Error(`Unsupported streaming tool status: ${status}`);
  }
}

export function resolveStatus(status: string | undefined, source: OperationSource): HeaderStatus {
  return source === 'streaming' ? resolveStreamingStatus(status) : resolveStoredStatus(status);
}

export function buildOperationBase(
  params: MapToolToVmParams,
  title: string,
  targetId?: string,
  targetLabel?: string,
): OperationBaseVM {
  const args = coerceRecord(params.args);
  const status = resolveStatus(params.status, params.source);
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
