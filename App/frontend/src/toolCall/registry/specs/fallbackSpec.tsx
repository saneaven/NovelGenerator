import { FunctionCallCardShell } from '../../ui/FunctionCallCardShell';
import {
  buildOperationBase,
  coerceRecord,
  type MapToolToVmParams,
  type RenderCardParams,
  type ToolUiSpec,
} from '../contracts';
import type { ObjectOperationVM } from '../../ui/vmTypes';

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

const fallbackSpec: ToolUiSpec = {
  id: 'fallback',

  match(_toolName: string): boolean {
    return true;
  },

  toOperationVM(params: MapToolToVmParams): ObjectOperationVM {
    const args = coerceRecord(params.args);
    const base = buildOperationBase(params, `Tool: ${params.toolName}`);
    return {
      ...base,
      args,
      category: 'read',
      objectType: 'story_object',
    };
  },

  renderCard(params: RenderCardParams) {
    const operation = params.operation;
    return (
      <FunctionCallCardShell
        scopeKey={params.scopeKey}
        cardId={operation.id}
        category="read"
        status={operation.status}
        title={operation.title}
        subtitle={operation.status === 'failed' ? operation.reason : 'Unknown tool. Rendered with fallback spec.'}
        showDecisionButtons={params.showDecisionButtons}
        decisionDisabled={params.decisionDisabled}
        onAccept={params.onAccept}
        onReject={params.onReject}
        defaultExpanded
        islands={[
          <div key="fallback-args" className="function-call-fallback-island">
            <div className="function-call-fallback-island__label">Arguments</div>
            <pre className="function-call-fallback-island__pre">{stringify(operation.args)}</pre>
          </div>,
          <div key="fallback-result" className="function-call-fallback-island">
            <div className="function-call-fallback-island__label">Result</div>
            <pre className="function-call-fallback-island__pre">{stringify(operation.result)}</pre>
          </div>,
        ]}
      />
    );
  },

  getEditTitle(toolName: string): string {
    return `Tool: ${toolName}`;
  },

  getEditType(_toolName: string): string {
    return 'init';
  },

  getAutoApproveCategory(_toolName: string) {
    return null;
  },
};

export default fallbackSpec;
