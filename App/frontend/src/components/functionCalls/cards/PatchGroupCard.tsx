import React, { useCallback, useMemo, useState } from 'react';
import { TextButton } from '../../TextButton';
import ToggleSwitch from '../../common/ToggleSwitch';
import type { ToolCallDecisionMap } from '../../../toolCall/types';
import type { ObjectOperationVM } from '../../../functionCalls/types';
import { useFunctionCallUIStore } from '../../../store/functionCallUIStore';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import type { PatchGroupCardProps } from './types';

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
  const running = operations.filter((operation) => operation.status === 'running').length;
  const accepted = operations.filter((operation) => operation.status === 'accepted').length;
  const failed = operations.filter((operation) => operation.status === 'failed').length;
  const rejected = operations.filter((operation) => operation.status === 'rejected').length;

  const parts: string[] = [];
  if (pending > 0) parts.push(`Pending ${pending}`);
  if (running > 0) parts.push(`Running ${running}`);
  if (accepted > 0) parts.push(`Applied ${accepted}`);
  if (rejected > 0) parts.push(`Rejected ${rejected}`);
  if (failed > 0) parts.push(`Failed ${failed}`);
  return parts.join(' • ');
}

export const PatchGroupCard: React.FC<PatchGroupCardProps> = ({
  threadId,
  groupId,
  targetLabel,
  operations,
  decisionDisabled,
  onConfirm,
  onConfirmAndPause,
}) => {
  const patchDecisions = useFunctionCallUIStore(
    (state) => state.patchDecisionsByThread[threadId] ?? {}
  );
  const setPatchDecision = useFunctionCallUIStore((state) => state.setPatchDecision);
  const setPatchDecisionsBulk = useFunctionCallUIStore((state) => state.setPatchDecisionsBulk);

  const [isCommitting, setIsCommitting] = useState(false);

  const eligibleIds = useMemo(
    () => operations.filter((operation) => isPendingOperation(operation) && !operation.isValidationFailure).map((operation) => operation.id),
    [operations]
  );

  const statusSummary = useMemo(() => buildStatusSummary(operations), [operations]);

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
    : operations.some((operation) => operation.status === 'pending' || operation.status === 'validating')
      ? 'pending'
      : operations.every((operation) => operation.status === 'accepted')
        ? 'accepted'
        : operations.every((operation) => operation.status === 'rejected')
          ? 'rejected'
          : 'failed';

  const headerActions = (
    <div className="function-call-patch-header-actions">
      <TextButton size="sm" variant="secondary" onClick={handleToggleAllApply} disabled={disabled || eligibleIds.length === 0}>
        Apply All
      </TextButton>
      <TextButton size="sm" variant="danger" onClick={handleRejectAll} disabled={disabled || eligibleIds.length === 0}>
        Reject All
      </TextButton>
    </div>
  );

  return (
    <FunctionCallCardShell
      threadId={threadId}
      cardId={groupId}
      category="patch"
      status={groupStatus}
      title={`Patch ${targetLabel}`}
      targetLabel={`${operations.length} change${operations.length === 1 ? '' : 's'}`}
      subtitle={statusSummary}
      rightActions={headerActions}
      defaultExpanded={operations.some((operation) => operation.status === 'pending' || operation.status === 'running')}
    >
      <div className="function-call-patch-group-body">
        {operations.map((operation) => {
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
        })}

        <div className="function-call-patch-group-footer">
          {onConfirmAndPause && (
            <TextButton
              size="sm"
              variant="secondary"
              onClick={() => void handleConfirmAndPause()}
              disabled={disabled || eligibleIds.length === 0}
            >
              Confirm & Pause
            </TextButton>
          )}
          <TextButton
            size="sm"
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={disabled || eligibleIds.length === 0}
          >
            {isCommitting ? 'Applying...' : 'Confirm'}
          </TextButton>
        </div>
      </div>
    </FunctionCallCardShell>
  );
};

export default PatchGroupCard;
