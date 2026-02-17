import React, { useCallback, useMemo, useState } from 'react';
import { TextButton } from '../../../components/TextButton';
import ToggleSwitch from '../../../components/common/ToggleSwitch';
import { useSettingsStore } from '../../../store/settingsStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import type { ToolCallDecisionMap } from '../../types';
import type { ObjectOperationVM, PatchDecision } from '../vmTypes';
import { useFunctionCallUIStore } from '../store';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import type { PatchGroupCardProps } from './types';
import { getObjectSnapshot } from './helpers';

const EMPTY_PATCH_DECISIONS: Record<string, PatchDecision> = {};

function patchValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function isPendingOperation(operation: ObjectOperationVM): boolean {
  return operation.status === 'pending' || operation.status === 'validating';
}

function buildStatusSummary(operations: ObjectOperationVM[]): string {
  const pending = operations.filter((operation) => operation.status === 'pending' || operation.status === 'validating').length;
  const processing = operations.filter((operation) => operation.status === 'processing').length;
  const running = operations.filter((operation) => operation.status === 'running').length;
  const accepted = operations.filter((operation) => operation.status === 'accepted').length;
  const failed = operations.filter((operation) => operation.status === 'failed').length;
  const rejected = operations.filter((operation) => operation.status === 'rejected').length;

  const parts: string[] = [];
  if (pending > 0) parts.push(`Pending ${pending}`);
  if (processing > 0) parts.push(`Processing ${processing}`);
  if (running > 0) parts.push(`Running ${running}`);
  if (accepted > 0) parts.push(`Applied ${accepted}`);
  if (rejected > 0) parts.push(`Rejected ${rejected}`);
  if (failed > 0) parts.push(`Failed ${failed}`);
  return parts.join(' • ');
}

export const PatchGroupCard: React.FC<PatchGroupCardProps> = ({
  threadId,
  projectId,
  groupId,
  targetLabel,
  operations,
  decisionDisabled,
  onConfirm,
  onConfirmAndPause,
}) => {
  const language = useSettingsStore((state) => state.getSettings().mainLanguage);
  const objects = useUnifiedObjectStore((state) => state.objects);

  const displayName = useMemo(() => {
    const firstOp = operations[0];
    if (!firstOp) return targetLabel;
    const snapshot = getObjectSnapshot({ operation: firstOp, objects, projectId, language });
    return snapshot.displayName || targetLabel;
  }, [operations, objects, projectId, language, targetLabel]);

  const patchDecisions = useFunctionCallUIStore(
    (state) => state.patchDecisionsByThread[threadId]
  ) ?? EMPTY_PATCH_DECISIONS;
  const setPatchDecision = useFunctionCallUIStore((state) => state.setPatchDecision);
  const setPatchDecisionsBulk = useFunctionCallUIStore((state) => state.setPatchDecisionsBulk);

  const [isCommitting, setIsCommitting] = useState(false);

  const eligibleIds = useMemo(
    () => operations.filter((operation) => isPendingOperation(operation) && !operation.isValidationFailure).map((operation) => operation.id),
    [operations]
  );

  const statusSummary = useMemo(() => {
    const summary = buildStatusSummary(operations);
    const firstFailedReason = operations.find((op) => op.status === 'failed' && op.reason)?.reason;
    return firstFailedReason ? `${summary} — ${firstFailedReason}` : summary;
  }, [operations]);

  const buildDecisionMap = useCallback((): ToolCallDecisionMap => {
    const map: ToolCallDecisionMap = {};
    for (const operationId of eligibleIds) {
      map[operationId] = patchDecisions[operationId] ?? 'accept';
    }
    return map;
  }, [eligibleIds, patchDecisions]);

  const handleToggleAllApply = useCallback(() => {
    setPatchDecisionsBulk(threadId, eligibleIds, 'accept');
  }, [setPatchDecisionsBulk, threadId, eligibleIds]);

  const handleRejectAll = useCallback(() => {
    setPatchDecisionsBulk(threadId, eligibleIds, 'reject');
  }, [setPatchDecisionsBulk, threadId, eligibleIds]);

  const handleConfirm = useCallback(async () => {
    if (isCommitting) return;
    const decisions = buildDecisionMap();
    if (Object.keys(decisions).length === 0) return;

    setIsCommitting(true);
    try {
      await onConfirm(decisions);
    } finally {
      setIsCommitting(false);
    }
  }, [isCommitting, buildDecisionMap, onConfirm]);

  const handleConfirmAndPause = useCallback(async () => {
    if (!onConfirmAndPause || isCommitting) return;
    const decisions = buildDecisionMap();
    if (Object.keys(decisions).length === 0) return;

    setIsCommitting(true);
    try {
      await onConfirmAndPause(decisions);
    } finally {
      setIsCommitting(false);
    }
  }, [onConfirmAndPause, isCommitting, buildDecisionMap]);

  const disabled = Boolean(decisionDisabled || isCommitting);
  const groupStatus = operations.some((operation) => operation.status === 'running')
    ? 'running'
    : operations.some((operation) => operation.status === 'processing')
      ? 'processing'
    : operations.some((operation) => operation.status === 'pending' || operation.status === 'validating')
      ? 'pending'
      : operations.every((operation) => operation.status === 'accepted')
        ? 'accepted'
        : operations.every((operation) => operation.status === 'rejected')
          ? 'rejected'
          : 'failed';

  const hasEligible = eligibleIds.length > 0;

  const headerActions = hasEligible ? (
    <div className="function-call-patch-header-actions">
      <TextButton size="sm" variant="secondary" onClick={handleToggleAllApply} disabled={disabled}>
        Apply All
      </TextButton>
      <TextButton size="sm" variant="danger" onClick={handleRejectAll} disabled={disabled}>
        Reject All
      </TextButton>
    </div>
  ) : null;

  return (
    <FunctionCallCardShell
      threadId={threadId}
      cardId={groupId}
      category="patch"
      status={groupStatus}
      title={displayName}
      subtitle={statusSummary}
      rightActions={headerActions}
      defaultExpanded={operations.some((operation) => operation.status === 'pending' || operation.status === 'processing' || operation.status === 'running')}
      islands={[
        ...operations.map((operation) => {
          const field = typeof operation.args.field === 'string' ? operation.args.field : 'content';
          const oldText = patchValue(operation.args.old);
          const newText = patchValue(operation.args.new);
          const decision = patchDecisions[operation.id] ?? 'accept';
          const toggleDisabled = disabled || !isPendingOperation(operation) || operation.isValidationFailure;

          return (
            <div className="function-call-patch-row" key={operation.id}>
              <div className="function-call-patch-row__header">
                <div className="function-call-patch-row__meta">
                  <span className="function-call-patch-row__field">{field}</span>
                  <span className={`function-call-status-pill function-call-status-pill--${operation.status}`}>{operation.status}</span>
                  {operation.status === 'failed' && operation.reason && (
                    <span className="function-call-patch-row__reason">{operation.reason}</span>
                  )}
                </div>
                <ToggleSwitch
                  checked={decision === 'accept'}
                  onChange={(checked) => setPatchDecision(threadId, operation.id, checked ? 'accept' : 'reject')}
                  label={decision === 'accept' ? 'Apply' : 'Reject'}
                  disabled={toggleDisabled}
                />
              </div>

              <div className="function-call-patch-row__diff">
                <div className="function-call-patch-row__block function-call-patch-row__block--old">
                  <div className="function-call-patch-row__block-label">Old</div>
                  <pre>{oldText || '(empty)'}</pre>
                </div>
                <div className="function-call-patch-row__block function-call-patch-row__block--new">
                  <div className="function-call-patch-row__block-label">New</div>
                  <pre>{newText || '(empty)'}</pre>
                </div>
              </div>
            </div>
          );
        }),
        ...(hasEligible ? [
          <div className="function-call-patch-group-footer" key="footer">
            {onConfirmAndPause && (
              <TextButton
                size="sm"
                variant="secondary"
                onClick={() => void handleConfirmAndPause()}
                disabled={disabled}
              >
                Confirm & Pause
              </TextButton>
            )}
            <TextButton
              size="sm"
              variant="primary"
              onClick={() => void handleConfirm()}
              disabled={disabled}
            >
              {isCommitting ? 'Applying...' : 'Confirm'}
            </TextButton>
          </div>,
        ] : []),
      ]}
    />
  );
};

export default PatchGroupCard;
