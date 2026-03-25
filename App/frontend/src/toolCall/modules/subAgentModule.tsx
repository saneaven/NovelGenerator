import { buildOperationBase, coerceRecord, defineToolCallUiModule } from '../registry/contracts';
import { useSubAgentStore } from '../../store/subAgentStore';
import { CallAgentCard } from '../ui/cards/CallAgentCard';
import type { CallOperationVM } from '../ui/vmTypes';

function getCallDisplay(toolName: string): { agentName: string; displayName: string } {
  const agentName = toolName.replace(/^call_/, '').trim();
  const def = agentName ? useSubAgentStore.getState().getByAgentName(agentName) : undefined;
  const displayName = def?.display_name ?? (agentName || 'Sub Agent');
  return { agentName, displayName };
}

const subAgentModule = defineToolCallUiModule({
  key: 'sub_agent',
  matches(toolName) {
    return toolName.startsWith('call_');
  },
  mapOperation(params) {
    const args = coerceRecord(params.args);
    const { agentName, displayName } = getCallDisplay(params.toolName);
    const input = typeof args.input === 'string' ? args.input : '';
    const base = buildOperationBase(params, displayName, undefined, displayName);
    return {
      ...base,
      args,
      category: 'call',
      agentName,
      displayName,
      input,
    } as CallOperationVM;
  },
  buildRenderItems(operations, ctx) {
    return (operations as CallOperationVM[]).map((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return {
        id: operation.id,
        operationIds: [operation.id],
        element: (
          <CallAgentCard
            key={operation.id}
            threadId={ctx.threadId}
            scopeKey={ctx.scopeKey}
            projectId={ctx.projectId}
            operation={operation}
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
    const { displayName } = getCallDisplay(toolName);
    return {
      title: `Call ${displayName}`,
      type: 'init',
    };
  },
});

export default subAgentModule;
