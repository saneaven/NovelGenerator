import React from 'react';
import type { McpSelectionAudit } from '../../types/mcp';

interface MessageMcpChipRowProps {
  selections: McpSelectionAudit[];
}

const MessageMcpChipRow: React.FC<MessageMcpChipRowProps> = React.memo(({
  selections,
}) => {
  if (selections.length === 0) return null;

  return (
    <div className="thread-message-mcp-chips">
      {selections.map((selection) => (
        <div key={selection.selection_id} className="thread-message-mcp-chip">
          <span className="thread-message-mcp-chip__kind">{selection.kind}</span>
          <span className="thread-message-mcp-chip__label">{selection.summary_label}</span>
        </div>
      ))}
    </div>
  );
});

export default MessageMcpChipRow;
