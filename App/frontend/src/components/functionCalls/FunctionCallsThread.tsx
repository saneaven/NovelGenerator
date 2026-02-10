import React, { useCallback, useMemo, useState } from 'react';
import type { ToolCallProgress } from '../../llm/requestTypes';
import type { EditCard, ToolCallDecision, ToolCallDecisionMap } from '../../toolCall/types';
import { buildStoredOperations } from '../../functionCalls/buildStoredOperations';
import { buildStreamingOperations } from '../../functionCalls/buildStreamingOperations';
import { groupPatchOperations } from '../../functionCalls/patchGrouping';
import type { ObjectOperationVM, OperationVM } from '../../functionCalls/types';
import { useFunctionCallUIStore } from '../../store/functionCallUIStore';
import { CreateCallCard } from './cards/CreateCallCard';
import { ReadCallCard } from './cards/ReadCallCard';
import { ReplaceCallCard } from './cards/ReplaceCallCard';
import { DeleteCallCard } from './cards/DeleteCallCard';
import { SearchCallCard } from './cards/SearchCallCard';
import { CallAgentCard } from './cards/CallAgentCard';
import { PatchGroupCard } from './cards/PatchGroupCard';
import { StickyDecisionBar } from './StickyDecisionBar';
import './functionCalls.css';

export interface FunctionCallsThreadProps {
  threadId: string;
  mode: 'streaming' | 'pending' | 'confirmed';
  cards?: EditCard[];
  streamingProgress?: ToolCallProgress[];
  onCommitDecisions?: (decisions: ToolCallDecisionMap) => Promise<void>;
  onCommitDecisionsAndPause?: (decisions: ToolCallDecisionMap) => Promise<void>;
  projectId: string;
  isApplyDisabled?: boolean;
  applyDisabledReason?: string;
}

function isPatchOperation(operation: OperationVM): operation is ObjectOperationVM {
  return operation.category === 'patch';
}

function isObjectOperation(operation: OperationVM): operation is ObjectOperationVM {
  return operation.category !== 'search' && operation.category !== 'call_agent';
}

export const FunctionCallsThread: React.FC<FunctionCallsThreadProps> = ({
  threadId,
  mode,
  cards = [],
  streamingProgress = [],
  onCommitDecisions,
  onCommitDecisionsAndPause,
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

    const decisions: ToolCallDecisionMap = {};
    for (const operationId of unresolvedIds) {
      decisions[operationId] = 'accept';
    }
    await commitDecisions(decisions);
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, threadId, commitDecisions]);

  const handleRejectAll = useCallback(async () => {
    if (!hasDecisionFlow || isApplyDisabled || unresolvedIds.length === 0) return;
    setPatchDecisionsBulk(threadId, unresolvedIds, 'reject');

    const decisions: ToolCallDecisionMap = {};
    for (const operationId of unresolvedIds) {
      decisions[operationId] = 'reject';
    }
    await commitDecisions(decisions);
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, threadId, commitDecisions]);

  if (operations.length === 0) return null;

  return (
    <div className={`function-calls-thread function-calls-thread--${mode}`}>
      {applyDisabledReason && (
        <div className="function-calls-thread__warning">{applyDisabledReason}</div>
      )}

      {nonPatchOperations.map((operation) => {
        const showDecisionButtons = hasDecisionFlow && operation.decisionEligible;
        const decisionDisabled = isApplyDisabled || committingById[operation.id] === true;

        if (operation.category === 'read' && isObjectOperation(operation)) {
          return (
            <ReadCallCard
              key={operation.id}
              threadId={threadId}
              projectId={projectId}
              operation={operation}
              showDecisionButtons={showDecisionButtons}
              decisionDisabled={decisionDisabled}
              onAccept={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined}
              onReject={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined}
            />
          );
        }

        if (operation.category === 'create' && isObjectOperation(operation)) {
          return (
            <CreateCallCard
              key={operation.id}
              threadId={threadId}
              projectId={projectId}
              operation={operation}
              showDecisionButtons={showDecisionButtons}
              decisionDisabled={decisionDisabled}
              onAccept={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined}
              onReject={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined}
            />
          );
        }

        if (operation.category === 'replace' && isObjectOperation(operation)) {
          return (
            <ReplaceCallCard
              key={operation.id}
              threadId={threadId}
              projectId={projectId}
              operation={operation}
              showDecisionButtons={showDecisionButtons}
              decisionDisabled={decisionDisabled}
              onAccept={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined}
              onReject={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined}
            />
          );
        }

        if (operation.category === 'delete' && isObjectOperation(operation)) {
          return (
            <DeleteCallCard
              key={operation.id}
              threadId={threadId}
              projectId={projectId}
              operation={operation}
              showDecisionButtons={showDecisionButtons}
              decisionDisabled={decisionDisabled}
              onAccept={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined}
              onReject={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined}
            />
          );
        }

        if (operation.category === 'search') {
          return (
            <SearchCallCard
              key={operation.id}
              threadId={threadId}
              projectId={projectId}
              operation={operation}
              showDecisionButtons={showDecisionButtons}
              decisionDisabled={decisionDisabled}
              onAccept={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined}
              onReject={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined}
            />
          );
        }

        if (operation.category === 'call_agent') {
          return (
            <CallAgentCard
              key={operation.id}
              threadId={threadId}
              projectId={projectId}
              operation={operation}
              showDecisionButtons={showDecisionButtons}
              decisionDisabled={decisionDisabled}
              onAccept={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined}
              onReject={showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined}
            />
          );
        }

        return null;
      })}

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
        disabled={isApplyDisabled}
        unresolvedCount={unresolvedIds.length}
        onAcceptAll={() => void handleAcceptAll()}
        onRejectAll={() => void handleRejectAll()}
      />
    </div>
  );
};

export default FunctionCallsThread;
