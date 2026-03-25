import { buildOperationBase, coerceRecord, defineToolCallUiModule } from '../registry/contracts';
import { SearchCallCard } from '../ui/cards/SearchCallCard';
import type { SearchOperationVM } from '../ui/vmTypes';

function searchTypeForTool(toolName: string): SearchOperationVM['searchType'] {
  return toolName === 'search_keyword' ? 'keyword' : 'semantic';
}

const searchModule = defineToolCallUiModule({
  key: 'search',
  toolNames: ['search_keyword', 'search_semantic'],
  mapOperation(params) {
    const args = coerceRecord(params.args);
    const searchType = searchTypeForTool(params.toolName);
    const title = searchType === 'semantic' ? 'Semantic Search' : 'Keyword Search';
    const base = buildOperationBase(params, title, undefined, title);
    return {
      ...base,
      args,
      category: 'search',
      searchType,
    } as SearchOperationVM;
  },
  buildRenderItems(operations, ctx) {
    return (operations as SearchOperationVM[]).map((operation) => {
      const decisionProps = ctx.getDecisionProps(operation);
      return {
        id: operation.id,
        operationIds: [operation.id],
        element: (
          <SearchCallCard
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
    return {
      title: toolName === 'search_keyword' ? 'Keyword Search' : 'Semantic Search',
      type: 'init',
    };
  },
});

export default searchModule;
