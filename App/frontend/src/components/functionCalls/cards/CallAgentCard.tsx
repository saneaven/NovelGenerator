import React from 'react';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import type { CallAgentCardProps } from './types';

export const CallAgentCard: React.FC<CallAgentCardProps> = ({
  threadId,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const title = `Call ${operation.displayName}`;
  const input = operation.input?.trim() ? operation.input : '(no input)';

  return (
    <FunctionCallCardShell
      threadId={threadId}
      cardId={operation.id}
      category="call_agent"
      status={operation.status}
      title={title}
      targetLabel={operation.agentName}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={operation.status === 'pending' || operation.status === 'running'}
    >
      <div className="function-call-call-agent-body">
        <div className="function-call-call-agent-body__label">Sub-agent request</div>
        <MarkdownRenderer className="function-call-call-agent-body__content">{input}</MarkdownRenderer>
      </div>
    </FunctionCallCardShell>
  );
};

export default CallAgentCard;
