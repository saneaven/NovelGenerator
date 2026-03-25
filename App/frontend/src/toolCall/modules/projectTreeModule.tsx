import { buildOperationBase, defineToolCallUiModule } from '../registry/contracts';
import { FunctionCallCardShell } from '../ui/FunctionCallCardShell';
import type { OperationBaseVM, OperationVM } from '../ui/vmTypes';

interface ProjectTreeOperationVM extends OperationBaseVM {
  category: 'get';
}

const projectTreeModule = defineToolCallUiModule({
  key: 'project_tree',
  toolNames: ['get_project_tree'],
  mapOperation(params) {
    const base = buildOperationBase(params, 'Project Tree');
    return { ...base, category: 'get' } as ProjectTreeOperationVM as OperationVM;
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
            category="get"
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
  getEditMeta() {
    return { title: 'Project Tree', type: 'init' };
  },
});

export default projectTreeModule;
