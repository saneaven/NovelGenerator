import React, { useCallback, useMemo, useState } from 'react';
import type { ToolCallProgress } from '../../types/chat';
import type { EditCard, ToolCallDecision, ToolCallDecisionMap } from '../types';
import { resolveToolUiModule, type DecisionRenderProps, type RenderItem } from '../registry';
import { buildStoredOperations, buildStreamingOperations } from './buildOperations';
import type { OperationVM } from './vmTypes';
import { useFunctionCallUIStore } from './store';
import { StickyDecisionBar } from './StickyDecisionBar';
import { IconButton } from '../../components/IconButton';
import { Trash } from '../../components/icons';
import './functionCalls.css';

export interface FunctionCallsThreadProps {
  threadId: string;
  scopeKey: string;
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

export const FunctionCallsThread: React.FC<FunctionCallsThreadProps> = ({
  threadId,
  scopeKey,
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

  const unresolvedIds = useMemo(
    () => operations
      .filter((operation) => operation.decisionEligible && operation.includeInBulkDecision && !operation.isValidationFailure)
      .map((operation) => operation.id),
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
    setPatchDecisionsBulk(scopeKey, unresolvedIds, 'accept');

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
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, scopeKey, commitDecisions]);

  const handleAcceptAllAndPause = useCallback(async () => {
    if (!hasDecisionFlow || isApplyDisabled || unresolvedIds.length === 0 || !onCommitDecisionsAndPause) return;
    setPatchDecisionsBulk(scopeKey, unresolvedIds, 'accept');

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
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, scopeKey, onCommitDecisionsAndPause, commitDecisions]);

  const handleRejectAll = useCallback(async () => {
    if (!hasDecisionFlow || isApplyDisabled || unresolvedIds.length === 0) return;
    setPatchDecisionsBulk(scopeKey, unresolvedIds, 'reject');

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
  }, [hasDecisionFlow, isApplyDisabled, unresolvedIds, setPatchDecisionsBulk, scopeKey, commitDecisions]);

  const wrapCard = useCallback((element: React.ReactElement, operationId: string, renderItemId: string) => {
    if (!onDeleteCard) return element;
    return (
      <div className="function-call-card-slot" key={renderItemId}>
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

  const getDecisionProps = useCallback((operation: OperationVM): DecisionRenderProps => {
    const showDecisionButtons = hasDecisionFlow && operation.decisionEligible;
    const decisionDisabled = isApplyDisabled || committingById[operation.id] === true;
    return {
      showDecisionButtons,
      decisionDisabled,
      onAccept: showDecisionButtons ? () => void handleSingleDecision(operation.id, 'accept') : undefined,
      onReject: showDecisionButtons ? () => void handleSingleDecision(operation.id, 'reject') : undefined,
    };
  }, [committingById, handleSingleDecision, hasDecisionFlow, isApplyDisabled]);

  const renderItems = useMemo(() => {
    const grouped = new Map<string, { module: ReturnType<typeof resolveToolUiModule>; operations: OperationVM[] }>();
    const order: string[] = [];

    for (const operation of operations) {
      const module = resolveToolUiModule(operation.toolName);
      const key = module.prefix;
      const existing = grouped.get(key);
      if (existing) {
        existing.operations.push(operation);
        continue;
      }
      order.push(key);
      grouped.set(key, { module, operations: [operation] });
    }

    const out: RenderItem[] = [];
    for (const key of order) {
      const entry = grouped.get(key);
      if (!entry) continue;
      out.push(
        ...entry.module.buildRenderItems(entry.operations, {
          threadId,
          scopeKey,
          projectId,
          getDecisionProps,
          onCommitDecisions: commitDecisions,
          onCommitDecisionsAndPause: onCommitDecisionsAndPause ? (decisions) => commitDecisions(decisions, true) : undefined,
        })
      );
    }
    return out;
  }, [operations, threadId, scopeKey, projectId, getDecisionProps, commitDecisions, onCommitDecisionsAndPause]);

  if (operations.length === 0) return null;

  return (
    <div className={`function-calls-thread function-calls-thread--${mode}`}>
      {applyDisabledReason && (
        <div className="function-calls-thread__warning">{applyDisabledReason}</div>
      )}

      {renderItems.map((item) => {
        if (!item.element) return null;
        if (!item.deleteOperationId || !onDeleteCard) {
          return <React.Fragment key={item.id}>{item.element}</React.Fragment>;
        }
        return wrapCard(item.element, item.deleteOperationId, item.id);
      })}

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
