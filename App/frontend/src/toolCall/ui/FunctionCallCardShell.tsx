import React, { useCallback } from 'react';
import type { HeaderStatus, OperationCategory } from './vmTypes';
import { useFunctionCallUIStore } from './store';
import { FunctionCallHeaderIsland } from './FunctionCallHeaderIsland';
import { FunctionCallContentIsland } from './FunctionCallContentIsland';

export interface FunctionCallCardShellProps {
  scopeKey: string;
  cardId: string;
  category: OperationCategory;
  status: HeaderStatus;
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  canToggle?: boolean;

  showDecisionButtons?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  decisionDisabled?: boolean;

  rightActions?: React.ReactNode;
  /**
   * Content islands rendered below the header.
   * Each element becomes a visually distinct, collapsible island
   * that shares the same expand / collapse toggle.
   */
  islands?: React.ReactNode[];
}

export const FunctionCallCardShell: React.FC<FunctionCallCardShellProps> = ({
  scopeKey,
  cardId,
  category,
  status,
  title,
  subtitle,
  defaultExpanded = false,
  canToggle = true,
  showDecisionButtons = false,
  onAccept,
  onReject,
  decisionDisabled = false,
  rightActions,
  islands,
}) => {
  const expanded = useFunctionCallUIStore(
    (state) => state.expandedByThread[scopeKey]?.[cardId] ?? defaultExpanded
  );
  const setExpanded = useFunctionCallUIStore((state) => state.setExpanded);

  const handleToggle = useCallback(() => {
    setExpanded(scopeKey, cardId, !expanded);
  }, [setExpanded, scopeKey, cardId, expanded]);

  const panelId = `function-call-card-panel-${cardId}`;

  return (
    <div className={`function-call-card-shell function-call-card-shell--${category}`}>
      <FunctionCallHeaderIsland
        cardId={cardId}
        category={category}
        status={status}
        title={title}
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

      {islands?.map((island, index) => (
        <FunctionCallContentIsland
          key={index}
          panelId={`${panelId}-${index}`}
          expanded={expanded}
        >
          {island}
        </FunctionCallContentIsland>
      ))}
    </div>
  );
};

export default FunctionCallCardShell;
