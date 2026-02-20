import {
  buildOperationBase,
  coerceRecord,
  type AutoApproveCategory,
  type MapToolToVmParams,
  type RenderCardParams,
  type ToolUiSpec,
} from '../contracts';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { CallAgentCard } from '../../ui/cards/CallAgentCard';
import type { CallAgentOperationVM } from '../../ui/vmTypes';

function getCallAgentDisplay(toolName: string): { agentName: string; displayName: string } {
  const agentName = toolName.replace(/^call_/, '').trim();
  const def = agentName ? useSubAgentStore.getState().getByAgentName(agentName) : undefined;
  const displayName = def?.display_name ?? (agentName || 'Sub Agent');
  return { agentName, displayName };
}

const callAgentSpec: ToolUiSpec = {
  id: 'call_agent',

  match(toolName: string): boolean {
    return toolName.startsWith('call_');
  },

  toOperationVM(params: MapToolToVmParams): CallAgentOperationVM {
    const args = coerceRecord(params.args);
    const { agentName, displayName } = getCallAgentDisplay(params.toolName);
    const input = typeof args.input === 'string' ? args.input : '';

    const base = buildOperationBase(params, displayName, undefined, displayName);
    return {
      ...base,
      args,
      category: 'call_agent',
      agentName,
      displayName,
      input,
    };
  },

  renderCard(params: RenderCardParams) {
    const operation = params.operation as CallAgentOperationVM;
    return (
      <CallAgentCard
        key={operation.id}
        threadId={params.threadId}
        projectId={params.projectId}
        operation={operation}
        showDecisionButtons={params.showDecisionButtons}
        decisionDisabled={params.decisionDisabled}
        onAccept={params.onAccept}
        onReject={params.onReject}
      />
    );
  },

  getEditTitle(toolName: string): string {
    const { displayName } = getCallAgentDisplay(toolName);
    return `Call Sub Agent: ${displayName}`;
  },

  getEditType(_toolName: string): string {
    return 'init';
  },

  getAutoApproveCategory(_toolName: string): AutoApproveCategory {
    return 'subAgent';
  },
};

export default callAgentSpec;
