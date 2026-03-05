import React, { useCallback, useMemo, useState } from 'react';
import type { ToolCallProgress } from '../../types/chat';
import type { EditCard, ToolCallDecision, ToolCallDecisionMap } from '../types';
import { resolveToolUiSpec } from '../registry';
import { buildStoredOperations, buildStreamingOperations } from './buildOperations';
import { groupPatchOperations } from './patchGrouping';
import type { ObjectOperationVM, OperationVM } from './vmTypes';
import { useFunctionCallUIStore } from './store';
import { PatchGroupCard } from './cards/PatchGroupCard';
import { StickyDecisionBar } from './StickyDecisionBar';
import { IconButton } from '../../components/IconButton';
import { Trash } from '../../components/icons';
import './functionCalls.css';

export interface FunctionCallsThreadProps {
  threadId: string;
  mode: 'streaming' | 'pending' | 'confirmed';
  cards?: EditCard[];
  streamingProgress?: ToolCallProgress[];
  onCommitDecisions?: (decisions: ToolCallDecisionMap) => Promise<void>;
  onCommitDecisionsAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
  onDeleteCard?: (cardId: string) => void;
  projectId: string;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}

function isPatchOperation(operation: OperationVM): operation is ObjectOperationVM {
  return operation.category === 'patch';
}

export const FunctionCallsThread: React.FC<FunctionCallsThreadProps> = ({
  threadId,
  mode,
  cards = [],
  streamingProgress = [],
  onCommitDecisions,
  onCommitDecisionsAndPause,
  onDeleteCard,
  projectId,
  isApplyDisabled = false,
  applyDisabledReason,
}) => {
  const [committingById, setCommittingById] = useState<Record<string, boolean>>({});
  const setPatchDecisionsBulk = useFunctionCallUIStore((state) => state.setPatchDecisionsBulk);

  const operations = useMemo(() => {
    if (mode === 'streaming') {
      return buildStreamingOperations(streamingProgress);
    }
    return buildStoredOperations(cards);
  }, [mode, streamingProgress, cards]);

  const hasDecisionFlow = mode === 'pending' && Boolean(onCommitDecisions);

  const patchOperations = useMemo(
    () => operations.filter(isPatchOperation),
    [operations]
  );

  const patchGroups = useMemo(
    () => groupPatchOperations(patchOperations),
    [patchOperations]
  );

  const nonPatchOperations = useMemo(
    () => operations.filter((operation) => operation.category !== 'patch'),
    [operations]
  );

  const unresolvedIds = useMemo(
    () => operations.filter((operation) => operation.decisionEligible && !operation.isValidationFailure).map((operation) => operation.id),
    [operations]
  );

  const commitDecisions = useCallback(
    async (decisions: ToolCallDecisionMap, andPause: boolean = false) => {
      if (!hasDecisionFlow || isApplyDisabled) return;
      if (Object.keys(decisions).length === 0) return;

      if (andPause && onCommitDecisionsAndPause) {
        await onCommitDecisionsAndPause(decisions);
        return;
      }

      if (!onCommitDecisions) return;
      await onCommitDecisions(decisions);
    },
    [hasDecisionFlow, isApplyDisabled, onCommitDecisions, onCommitDecisionsAndPause]
  );

  const handleSingleDecision = useCallback(
    async (operationId: string, decision: ToolCallDecision) => {
      if (!hasDecisionFlow || isApplyDisabled) return;
      if (committingById[operationId]) return;

      setCommittingById((prev) => ({ ...prev, [operationId]: true }));
      try {
        await commitDecisions({ [operationId]: decision });
      } finally {
        setCommittingById((prev) => {
          const next = { ...prev };
          delete next[operationId];
          return next;
        });
      }
    },
    [hasDecisionFlow, isApplyDisabled, committingById, commitDecisions]
  );

  const handleAcceptAll = useCallback(async () => {
    if (!hasDecisionFlow || isApplyDisabled || unresolvedIds.length === 0) return;
    setPatchDecisionsBulk(threadId, unresolvedIds, 'accept');

    // Mark all operations as committing for per-card button blocking
    setCommittingById((prev) => {
      const next = { ...prev };
      for (const id of unresolvedIds) next[id] = true;
      return next;
    });

    const decisions: ToolCallDecisionMap = {};
    for (const operationId of unresolvedIds) {
      decisions[operationId] = 'accept';
    }
    try {
      await commitDecisions(decisions);
    } finally {
      setCommittingById((prev) => {
        const next = { ...prev };
        for (const id of unresolvedIds) delete next[id];
        return next;
      });
    }
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, threadId, commitDecisions]);

  const handleAcceptAllAndPause = useCallback(async () => {
    if (!hasDecisionFlow || isApplyDisabled || unresolvedIds.length === 0 || !onCommitDecisionsAndPause) return;
    setPatchDecisionsBulk(threadId, unresolvedIds, 'accept');

    setCommittingById((prev) => {
      const next = { ...prev };
      for (const id of unresolvedIds) next[id] = true;
      return next;
    });

    const decisions: ToolCallDecisionMap = {};
    for (const operationId of unresolvedIds) {
      decisions[operationId] = 'accept';
    }
    try {
      await commitDecisions(decisions, true);
    } finally {
      setCommittingById((prev) => {
        const next = { ...prev };
        for (const id of unresolvedIds) delete next[id];
        return next;
      });
    }
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, threadId, onCommitDecisionsAndPause, commitDecisions]);

  const handleRejectAll = useCallback(async () => {
    if (!hasDecisionFlow || isApplyDisabled || unresolvedIds.length === 0) return;
    setPatchDecisionsBulk(threadId, unresolvedIds, 'reject');

    setCommittingById((prev) => {
      const next = { ...prev };
      for (const id of unresolvedIds) next[id] = true;
      return next;
    });

    const decisions: ToolCallDecisionMap = {};
    for (const operationId of unresolvedIds) {
      decisions[operationId] = 'reject';
    }
    try {
      await commitDecisions(decisions);
    } finally {
      setCommittingById((prev) => {
        const next = { ...prev };
        for (const id of unresolvedIds) delete next[id];
        return next;
      });
    }
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, threadId, commitDecisions]);

  const wrapCard = useCallback((element: React.ReactElement, operationId: string) => {
    if (!onDeleteCard) return element;
    return (
      <div className="function-call-card-slot" key={operationId}>
        {element}
        <div className="function-call-card-slot__actions">
          <div className="action-buttons">
            <IconButton
              icon={<Trash size="sm" />}
              onClick={() => onDeleteCard(operationId)}
              title="Delete"
              variant="ghost"
              size="sm"
              className="icon-button--ghost-danger"
            />
          </div>
        </div>
      </div>
    );
  }, [onDeleteCard]);

  if (operations.length === 0) return null;

  const renderCard = (operation: OperationVM) => {
    const showDecisionButtons = hasDecisionFlow && operation.decisionEligible;
    const decisionDisabled = isApplyDisabled || committingById[operation.id] === true;
    const spec = resolveToolUiSpec(operation.toolName);
    const card = spec.renderCard({
      threadId,
      projectId,
      operation,
      showDecisionButtons,
      decisionDisabled,
      onAccept: showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined,
      onReject: showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined,
    });

    if (!card) return null;
    return wrapCard(card, operation.id);
  };

  return (
    <div className={`function-calls-thread function-calls-thread--${mode}`}>
      {applyDisabledReason && (
        <div className="function-calls-thread__warning">{applyDisabledReason}</div>
      )}

      {nonPatchOperations.map(renderCard)}

      {patchGroups.length > 0 && (
        <div className="function-calls-thread__patch-groups">
          {patchGroups.map((group) => (
            <PatchGroupCard
              key={group.id}
              threadId={threadId}
              projectId={projectId}
              groupId={group.id}
              targetLabel={group.label}
              operations={group.operations}
              decisionDisabled={isApplyDisabled || !hasDecisionFlow}
              onConfirm={commitDecisions}
              onConfirmAndPause={onCommitDecisionsAndPause ? (decisions) => commitDecisions(decisions, true) : undefined}
            />
          ))}
        </div>
      )}

      <StickyDecisionBar
        visible={hasDecisionFlow && unresolvedIds.length > 0}
        disabled={isApplyDisabled || Object.keys(committingById).length > 0}
        unresolvedCount={unresolvedIds.length}
        onAcceptAll={() => void handleAcceptAll()}
        onAcceptAllAndPause={onCommitDecisionsAndPause ? () => void handleAcceptAllAndPause() : undefined}
        onRejectAll={() => void handleRejectAll()}
      />
    </div>
  );
};

export default FunctionCallsThread;
