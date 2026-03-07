import {
  buildOperationBase,
  coerceRecord,
  type AutoApproveCategory,
  type MapToolToVmParams,
  type RenderCardParams,
  type ToolUiSpec,
} from '../contracts';
import { SearchCallCard } from '../../ui/cards/SearchCallCard';
import type { SearchOperationVM, SearchType } from '../../ui/vmTypes';

function searchTypeForTool(toolName: string): SearchType {
  return toolName === 'keyword_search' ? 'keyword' : 'rag';
}

const searchSpec: ToolUiSpec = {
  id: 'search',

  match(toolName: string): boolean {
    return toolName === 'keyword_search' || toolName === 'rag_search';
  },

  toOperationVM(params: MapToolToVmParams): SearchOperationVM {
    const args = coerceRecord(params.args);
    const searchType = searchTypeForTool(params.toolName);
    const title = searchType === 'rag' ? 'RAG' : 'Keyword';

    const base = buildOperationBase(params, title, undefined, title);
    return {
      ...base,
      args,
      category: 'search',
      searchType,
    };
  },

  renderCard(params: RenderCardParams) {
    const operation = params.operation as SearchOperationVM;
    return (
      <SearchCallCard
        key={operation.id}
        threadId={params.threadId}
        scopeKey={params.scopeKey}
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
    return toolName === 'keyword_search' ? 'Keyword Search' : 'RAG Search';
  },

  getEditType(_toolName: string): string {
    return 'init';
  },

  getAutoApproveCategory(_toolName: string): AutoApproveCategory {
    return 'search';
  },
};

export default searchSpec;
