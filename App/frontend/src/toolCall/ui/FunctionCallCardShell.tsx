import React, { useCallback } from 'react';
import type { HeaderStatus, OperationCategory } from '../viewModel/types';
import { useFunctionCallUIStore } from './store';
import { FunctionCallHeaderIsland } from './FunctionCallHeaderIsland';
import { FunctionCallContentIsland } from './FunctionCallContentIsland';

export interface FunctionCallCardShellProps {
  threadId: string;
  cardId: string;
  category: OperationCategory;
  status: HeaderStatus;
  title: string;
  targetLabel?: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  canToggle?: boolean;

  showDecisionButtons?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  decisionDisabled?: boolean;

  rightActions?: React.ReactNode;
  /**
   * Additional islands rendered after the collapsible content island.
   * Accepts any ReactNode — a single element, a fragment, or an array.
   * Each top-level element becomes a visually distinct island within the card.
   */
  extraIslands?: React.ReactNode;
  children?: React.ReactNode;
}

export const FunctionCallCardShell: React.FC<FunctionCallCardShellProps> = ({
  threadId,
  cardId,
  category,
  status,
  title,
  targetLabel,
  subtitle,
  defaultExpanded = false,
  canToggle = true,
  showDecisionButtons = false,
  onAccept,
  onReject,
  decisionDisabled = false,
  rightActions,
  extraIslands,
  children,
}) => {
  const expanded = useFunctionCallUIStore(
    (state) => state.expandedByThread[threadId]?.[cardId] ?? defaultExpanded
  );
  const setExpanded = useFunctionCallUIStore((state) => state.setExpanded);

  const handleToggle = useCallback(() => {
    setExpanded(threadId, cardId, !expanded);
  }, [setExpanded, threadId, cardId, expanded]);

  const panelId = `function-call-card-panel-${cardId}`;

  return (
    <div className={`function-call-card-shell function-call-card-shell--${category}`}>
      <FunctionCallHeaderIsland
        cardId={cardId}
        category={category}
        status={status}
        title={title}
        targetLabel={targetLabel}
        subtitle={subtitle}
        expanded={expanded}
        onToggle={handleToggle}
        canToggle={canToggle}
        showDecisionButtons={showDecisionButtons}
        onAccept={onAccept}
        onReject={onReject}
        decisionDisabled={decisionDisabled}
        rightActions={rightActions}
      />

      {children && (
        <FunctionCallContentIsland panelId={panelId} expanded={expanded}>
          {children}
        </FunctionCallContentIsland>
      )}

      {extraIslands}
    </div>
  );
};

export default FunctionCallCardShell;
