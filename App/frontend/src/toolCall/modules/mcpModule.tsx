import { buildOperationBase, defineToolCallUiModule } from '../registry/contracts';
import { FunctionCallCardShell } from '../ui/FunctionCallCardShell';
import type { OperationBaseVM, OperationVM } from '../ui/vmTypes';

interface McpOperationVM extends OperationBaseVM {
  category: 'mcp';
}

function mcpTitle(toolName: string): string {
  const stripped = toolName.replace(/^mcp__/, '');
  return stripped ? `MCP: ${stripped}` : 'MCP Tool';
}

const mcpModule = defineToolCallUiModule({
  key: 'mcp',
  matches(toolName) {
    return toolName.startsWith('mcp__');
  },
  mapOperation(params) {
    const base = buildOperationBase(params, mcpTitle(params.toolName));
    return { ...base, category: 'mcp' } as McpOperationVM as OperationVM;
  },
  buildRenderItems(operations, ctx) {
    return operations.map((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return {
        id: operation.id,
        operationIds: [operation.id],
        element: (
          <FunctionCallCardShell
            key={operation.id}
            scopeKey={ctx.scopeKey}
            cardId={operation.id}
            category="mcp"
            status={operation.status}
            title={operation.title}
            subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
            showDecisionButtons={decisionProps.showDecisionButtons}
            decisionDisabled={decisionProps.decisionDisabled}
            onAccept={decisionProps.onAccept}
            onReject={decisionProps.onReject}
          />
        ),
      };
    });
  },
  getEditMeta(toolName) {
    return { title: mcpTitle(toolName), type: 'init' };
  },
});

export default mcpModule;
