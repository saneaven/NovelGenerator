import React from 'react';
import { buildOperationBase, coerceRecord, defineToolCallUiModule } from '../registry/contracts';
import { FunctionCallCardShell } from '../ui/FunctionCallCardShell';
import type { CallOperationVM } from '../ui/vmTypes';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

const FallbackCardBody: React.FC<{ args: Record<string, unknown> }> = ({ args }) => {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;

  return (
    <div className="function-call-fallback-body">
      {entries.map(([key, value]) => (
        <div key={key} className="function-call-fallback-body__row">
          <span className="function-call-fallback-body__key">{key}</span>
          <span className="function-call-fallback-body__value">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
};

const fallbackModule = defineToolCallUiModule({
  key: 'fallback',
  mapOperation(params) {
    const args = coerceRecord(params.args);
    const base = buildOperationBase(params, params.toolName);
    return {
      ...base,
      args,
      category: 'call',
      agentName: params.toolName,
      displayName: params.toolName,
      input: JSON.stringify(args),
    } as CallOperationVM;
  },
  buildRenderItems(operations, ctx) {
    return (operations as CallOperationVM[]).map((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return {
        id: operation.id,
        operationIds: [operation.id],
        element: (
          <FunctionCallCardShell
            key={operation.id}
            scopeKey={ctx.scopeKey}
            cardId={operation.id}
            category={operation.category}
            status={operation.status}
            title={operation.toolName}
            subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
            showDecisionButtons={decisionProps.showDecisionButtons}
            decisionDisabled={decisionProps.decisionDisabled}
            onAccept={decisionProps.onAccept}
            onReject={decisionProps.onReject}
            islands={
              Object.keys(operation.args).length > 0
                ? [<FallbackCardBody key="body" args={operation.args} />]
                : undefined
            }
          />
        ),
      };
    });
  },
  getEditMeta(toolName) {
    return {
      title: toolName,
      type: 'unknown',
    };
  },
});

export default fallbackModule;
