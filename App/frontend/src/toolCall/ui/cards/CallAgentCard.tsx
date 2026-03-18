import React from 'react';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import type { CallAgentCardProps } from './types';

export const CallAgentCard: React.FC<CallAgentCardProps> = ({
  scopeKey,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const storeDisplayName = useSubAgentStore(
    (state) => state.subAgents.find((s) => s.agent_name === operation.agentName)?.display_name,
  );
  const title = storeDisplayName ?? operation.displayName;
  const input = operation.input?.trim() ? operation.input : '(no input)';

  return (
    <FunctionCallCardShell
      scopeKey={scopeKey}
      cardId={operation.id}
      category={operation.category}
      status={operation.status}
      title={title}
      subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={
        operation.status === 'pending'
        || operation.status === 'processing'
        || operation.status === 'working'
        || operation.status === 'streaming'
      }
      islands={[
        <div className="function-call-call-agent-body" key="body">
          <div className="function-call-call-agent-body__label">Sub-agent request</div>
          <MarkdownRenderer className="function-call-call-agent-body__content">{input}</MarkdownRenderer>
        </div>,
      ]}
    />
  );
};

export default CallAgentCard;
