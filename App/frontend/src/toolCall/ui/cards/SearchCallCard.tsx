import React, { useMemo } from 'react';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import type { SearchCardProps } from './types';
import { extractSearchPayload } from './searchPayload';

export const SearchCallCard: React.FC<SearchCardProps> = ({
  scopeKey,
  operation,
  showDecisionButtons,
  decisionDisabled,
  onAccept,
  onReject,
}) => {
  const payload = useMemo(
    () => extractSearchPayload({
      resultData: operation.result?.data,
    }),
    [operation.result]
  );

  const resultsIsland = operation.status === 'applied' ? (
    <div className="function-call-search-results-island function-call-search-results-island--standalone">
      <div className="function-call-search-results-island__header">Search Results</div>
      {!payload || payload.groups.length === 0 ? (
        <div className="function-call-search-results-island__empty">No parsed search results.</div>
      ) : (
        <div className="function-call-search-results-island__groups">
          {payload.groups.map((group) => (
            <div className="function-call-search-result-group" key={`${group.objectType}:${group.objectId}`}>
              <div className="function-call-search-result-group__title">
                {group.displayName}
                <span className="function-call-search-result-group__meta">{group.objectType}</span>
              </div>
              <div className="function-call-search-result-group__entries">
                {group.entries.map((entry, index) => (
                  <div className="function-call-search-result-entry" key={`${group.objectId}-${index}`}>
                    {entry.fieldPath && (
                      <div className="function-call-search-result-entry__meta">{entry.fieldPath}</div>
                    )}
                    <div className="function-call-search-result-entry__text">{entry.text}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : operation.status === 'processing' || operation.status === 'streaming' ? (
    <div className="function-call-search-results-island function-call-search-results-island--standalone">
      <div className="function-call-search-results-island__empty">Searching...</div>
    </div>
  ) : null;

  return (
    <FunctionCallCardShell
      scopeKey={scopeKey}
      cardId={operation.id}
      category={operation.category}
      status={operation.status}
      title={operation.searchType === 'semantic' ? 'Semantic Search' : 'Regex Search'}
      subtitle={operation.status === 'failed' && operation.reason ? operation.reason : undefined}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={operation.status === 'pending' || operation.status === 'processing' || operation.status === 'streaming'}
      islands={[
        <div className="function-call-search-query-island" key="query">
          <div className="function-call-search-query-island__label">Query</div>
          {operation.searchType === 'semantic' ? (
            <ul className="function-call-search-query-island__list">
              {(Array.isArray(operation.args.queries)
                ? operation.args.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
                : [])
                .map((query, index) => <li key={`${query}-${index}`}>{query}</li>)}
            </ul>
          ) : (
            <div className="function-call-search-query-island__pattern-row">
              <span>{typeof operation.args.pattern === 'string' ? operation.args.pattern : '(empty pattern)'}</span>
              <div className="function-call-search-query-island__meta">
                {operation.args.case_sensitive === true && (
                  <span className="function-call-search-query-island__case-chip">Case sensitive</span>
                )}
                <span className="function-call-search-query-island__page-chip">
                  Page {typeof operation.args.page === 'number' ? operation.args.page : 1}
                </span>
              </div>
            </div>
          )}
        </div>,
        ...(resultsIsland ? [resultsIsland] : []),
      ]}
    />
  );
};

export default SearchCallCard;
