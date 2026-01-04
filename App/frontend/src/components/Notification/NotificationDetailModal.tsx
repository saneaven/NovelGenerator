import React, { useMemo, useCallback, useState } from 'react';
import { BaseModal } from '../BaseModal';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import { useSettingsStore } from '../../store/settingsStore';
import ThinkingDisplay from '../ThinkingDisplay';
import NotificationProgressBar from './NotificationProgressBar';
import { parse, Allow } from 'partial-json';
import { Close, ChevronDown, ChevronUp, Check, Warning } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { FunctionCallCard } from '../functionCall';
import {
  useCardsForSession,
  useEditCardStore,
  batchConfirmSession,
} from '../../functionCall';
import { convertApplicationResults, type ExtendedApplicationResult } from '../../llm/retry';
import type { CategorizedFunctionCallResult } from '../../llm/retry/types';
import './NotificationDetailModal.css';

// Content segment types for mixed text/JSON content
interface ContentSegment {
  type: 'text' | 'json';
  content: string;
  parsed?: any;
}

// Parse content into text and JSON segments
const parseContentSegments = (content: string): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)(?:```|$)/g;

  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index).trim();
      if (textContent) {
        segments.push({ type: 'text', content: textContent });
      }
    }

    // JSON code block
    const jsonContent = match[1].trim();
    if (jsonContent) {
      let parsed = null;
      try {
        parsed = parse(jsonContent, Allow.ALL);
      } catch {
        // Ignore parse errors during streaming
      }
      segments.push({
        type: 'json',
        content: jsonContent,
        parsed: parsed
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      segments.push({ type: 'text', content: textContent });
    }
  }

  // If no code blocks found, treat as plain text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content });
  }

  return segments;
};

// JSON Value renderer component
interface JsonValueProps {
  value: any;
  isLast?: boolean;
  isStreaming?: boolean;
  depth?: number;
}

const JsonValue: React.FC<JsonValueProps> = ({ value, isLast, isStreaming, depth = 0 }) => {
  // Null
  if (value === null) {
    return <span className="json-null">null</span>;
  }

  // String
  if (typeof value === 'string') {
    return (
      <>
        {value}
        {isLast && isStreaming && <span className="notification-detail-cursor">|</span>}
      </>
    );
  }

  // Number
  if (typeof value === 'number') {
    return <span className="json-number">{value}</span>;
  }

  // Boolean
  if (typeof value === 'boolean') {
    return <span className="json-boolean">{value.toString()}</span>;
  }

  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="json-empty">[]</span>;
    }
    return (
      <div className="json-array-viewer">
        {value.map((item, index) => (
          <div key={index} className="json-array-item">
            <div className="json-array-index">[{index}]</div>
            <div className="json-boxed-content">
              <JsonValue
                value={item}
                isLast={index === value.length - 1}
                isStreaming={isStreaming}
                depth={depth + 1}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Object
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="json-empty">{'{}'}</span>;
    }
    return (
      <div className={`json-object-fields ${depth === 0 ? 'json-root' : ''}`}>
        {entries.map(([key, val], index) => (
          <div key={key} className={`json-field ${depth === 0 ? 'json-field-root' : 'json-field-nested'}`}>
            <div className="json-field-label">{key}</div>
            <div className={depth >= 1 ? 'json-boxed-content' : 'json-field-value'}>
              <JsonValue
                value={val}
                isLast={index === entries.length - 1}
                isStreaming={isStreaming}
                depth={depth + 1}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <>{String(value)}</>;
};

// JSON Object Viewer component
interface JsonObjectViewerProps {
  data: any;
  isStreaming: boolean;
}

const JsonObjectViewer: React.FC<JsonObjectViewerProps> = ({ data, isStreaming }) => {
  if (!data) return null;
  return (
    <div className="json-object-viewer">
      <JsonValue value={data} isLast={true} isStreaming={isStreaming} depth={0} />
    </div>
  );
};

// Function Call Result Item Component
interface FunctionCallResultItemProps {
  result: CategorizedFunctionCallResult;
  defaultExpanded?: boolean;
}

const FunctionCallResultItem: React.FC<FunctionCallResultItemProps> = ({
  result,
  defaultExpanded = false
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const getStatusIcon = () => {
    if (result.success) {
      return <Check size="xs" className="function-result-icon function-result-icon--success" />;
    }
    if (result.isRejected) {
      return <Close size="xs" className="function-result-icon function-result-icon--rejected" />;
    }
    return <Warning size="xs" className="function-result-icon function-result-icon--error" />;
  };

  const getFailureTypeLabel = () => {
    switch (result.failureType) {
      case 'parsing_failed':
        return 'Parse Error';
      case 'validation_failed':
        return 'Validation Error';
      case 'application_failed':
        return 'Application Error';
      case 'user_rejected':
        return 'Rejected';
      default:
        return null;
    }
  };

  const failureLabel = getFailureTypeLabel();

  return (
    <div className={`function-result-item ${result.success ? 'function-result-item--success' : 'function-result-item--failed'}`}>
      <button
        className="function-result-item-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="function-result-status-icon">{getStatusIcon()}</span>
        <span className="function-result-name">{result.functionName}</span>
        {failureLabel && (
          <span className="function-result-failure-badge">{failureLabel}</span>
        )}
        <span className="function-result-expand-icon">
          {expanded ? <ChevronUp size="xs" /> : <ChevronDown size="xs" />}
        </span>
      </button>

      {expanded && (
        <div className="function-result-item-content">
          {/* Error message */}
          {result.error && (
            <div className="function-result-error-message">
              {result.error}
            </div>
          )}

          {/* Full arguments display */}
          {result.arguments && Object.keys(result.arguments).length > 0 && (
            <div className="function-result-arguments">
              <div className="function-result-arguments-label">Arguments</div>
              <JsonObjectViewer
                data={result.arguments}
                isStreaming={false}
              />
            </div>
          )}

          {/* Patch failures */}
          {result.patchFailures && result.patchFailures.length > 0 && (
            <div className="function-result-patch-failures">
              <div className="function-result-patch-failures-label">Patch Failures</div>
              <div className="function-result-patch-failures-list">
                {result.patchFailures.map((pf, i) => (
                  <div key={i} className="function-result-patch-failure-item">
                    <span className="patch-failure-field">{pf.fieldName}</span>
                    <span className="patch-failure-target">
                      ({pf.objectType}:{pf.objectId})
                    </span>
                    <span className="patch-failure-error">{pf.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface NotificationDetailModalProps {
  session: LLMTaskSessionState;
  onClose: () => void;
  onDismissToast: () => void;
  onRetry: (session: LLMTaskSessionState) => void;
}

const NotificationDetailModal: React.FC<NotificationDetailModalProps> = ({
  session,
  onClose,
  onDismissToast,
  onRetry
}) => {
  const cancelTask = useLLMTaskStore((state) => state.cancelTask);
  const setSuccess = useLLMTaskStore((state) => state.setSuccess);
  const setCancelled = useLLMTaskStore((state) => state.setCancelled);
  const setFunctionCallResults = useLLMTaskStore((state) => state.setFunctionCallResults);

  const mainLanguage = useSettingsStore((state) => state.settings.mainLanguage);
  const projectId = session.retryContext?.modalProps?.projectId;

  const [errorExpanded, setErrorExpanded] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Get EditCards from EditCardStore for pending_confirmation state
  const pendingEditCards = useCardsForSession(session.id);

  // Handle confirmation of function calls
  const handleConfirmFunctionCalls = useCallback(async (selections: Record<string, boolean>) => {
    if (!projectId || pendingEditCards.length === 0) return;

    setIsApplying(true);
    try {
      // Use batchConfirmSession to apply all selected cards
      await batchConfirmSession(session.id, selections, {
        projectId,
        language: mainLanguage,
      });

      // Get the updated cards to build aggregated results for retry support
      const updatedCards = useEditCardStore.getState().getCardsForSession(session.id);

      // Build aggregated results from cards
      const results: ExtendedApplicationResult[] = updatedCards.map(card => {
        if (card.functionCall?.status === 'accepted') {
          return {
            success: true,
            message: card.description || 'Applied successfully',
          } as ExtendedApplicationResult;
        } else if (card.functionCall?.status === 'rejected') {
          return {
            success: false,
            message: 'User rejected',
            error: 'User rejected this function call',
          } as ExtendedApplicationResult;
        } else {
          return {
            success: false,
            message: card.description || 'Failed',
            error: card.functionCall?.reason || 'Unknown error',
          } as ExtendedApplicationResult;
        }
      });

      // Convert to function call format for aggregation
      const functionCalls = updatedCards.map(card => ({
        id: card.id,
        function_name: card.functionCall?.functionName || '',
        arguments: card.functionCall?.arguments || {},
        status: card.functionCall?.status || 'pending' as const,
      }));

      // Convert results to aggregated format
      const aggregated = convertApplicationResults(
        session.id,
        functionCalls,
        results
      );

      // Update session with results
      setFunctionCallResults(session.id, aggregated);

      // Set status based on results
      setSuccess(session.id);
    } catch (error) {
      console.error('Failed to apply function calls:', error);
      // Keep pending_confirmation state on error
    } finally {
      setIsApplying(false);
    }
  }, [pendingEditCards, session.id, projectId, mainLanguage, setFunctionCallResults, setSuccess]);

  // Handle reject all
  const handleRejectAll = useCallback(() => {
    // Reject all cards in the session
    const store = useEditCardStore.getState();
    const cards = store.getCardsForSession(session.id);
    cards.forEach(card => {
      store.rejectSessionCard(session.id, card.id, 'User rejected all');
    });
    store.confirmSession(session.id);
    setCancelled(session.id);
  }, [session.id, setCancelled]);

  const handleCancel = useCallback(() => {
    cancelTask(session.id);
    onClose();
  }, [cancelTask, session.id, onClose]);

  const handleRetry = useCallback(() => {
    if (!session.retryContext) {
      console.warn('No retry context available');
      return;
    }
    onRetry(session);
  }, [session, onRetry]);

  const streamContent = useMemo(() => {
    if (!session.contentParts || session.contentParts.length === 0) {
      return '';
    }
    return session.contentParts
      .filter((part) => part.type === 'content')
      .map((part) => part.text)
      .join('');
  }, [session.contentParts]);

  // Parse content into text and JSON segments
  const contentSegments = useMemo(() => {
    if (!streamContent) return [];
    return parseContentSegments(streamContent);
  }, [streamContent]);

  const hasThinking = useMemo(() => {
    return session.contentParts?.some((part) => part.type === 'thinking') ?? false;
  }, [session.contentParts]);

  const hasContent = streamContent || hasThinking;

  const getStatusLabel = () => {
    switch (session.status) {
      case 'running':
        return 'In Progress';
      case 'pending_confirmation':
        return 'Awaiting Confirmation';
      case 'success':
        return 'Completed';
      case 'error':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  };

  // Truncate error message for summary display
  const getErrorSummary = () => {
    if (!session.error) return '';
    const maxLength = 100;
    if (session.error.length <= maxLength) return session.error;
    return session.error.slice(0, maxLength) + '...';
  };

  const renderFooter = () => {
    const failureCount = session.functionCallResults?.failureCount ?? 0;
    const hasRetryableFailures = failureCount > 0 && session.retryContext;

    if (session.status === 'running') {
      return (
        <div className="notification-detail-footer-actions">
          <TextButton variant="danger" onClick={handleCancel}>
            Cancel Task
          </TextButton>
          <TextButton variant="secondary" onClick={onClose}>
            Continue in Background
          </TextButton>
        </div>
      );
    }

    if (session.status === 'pending_confirmation') {
      return (
        <div className="notification-detail-footer-actions">
          <TextButton variant="danger" onClick={handleRejectAll} disabled={isApplying}>
            Reject All
          </TextButton>
          <TextButton variant="secondary" onClick={onClose} disabled={isApplying}>
            Continue in Background
          </TextButton>
        </div>
      );
    }

    if (session.status === 'error') {
      return (
        <div className="notification-detail-footer-actions">
          <TextButton variant="secondary" onClick={onDismissToast}>
            Dismiss
          </TextButton>
          {session.retryContext && (
            <TextButton variant="primary" onClick={handleRetry}>
              {hasRetryableFailures ? `Retry Failed (${failureCount})` : 'Retry'}
            </TextButton>
          )}
        </div>
      );
    }

    // Success state - still show retry if there are failures
    if (session.status === 'success' && hasRetryableFailures) {
      return (
        <div className="notification-detail-footer-actions">
          <TextButton variant="secondary" onClick={onClose}>
            Close
          </TextButton>
          <TextButton variant="primary" onClick={handleRetry}>
            Retry Failed ({failureCount})
          </TextButton>
        </div>
      );
    }

    return (
      <TextButton variant="secondary" onClick={onClose}>
        Close
      </TextButton>
    );
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      size="medium"
      showHeader={false}
      className="notification-detail-modal"
      footer={renderFooter()}
    >
      {/* Fixed Header */}
      <div className="notification-detail-header">
        <div className="notification-detail-title">
          <span className={`notification-detail-status notification-detail-status--${session.status}`}>
            {session.status === 'running' && (
              <span className="notification-detail-spinner" />
            )}
            {getStatusLabel()}
          </span>
          <h3>{session.label || 'Task'}</h3>
          {/* Error Summary in Header - expandable */}
          {session.status === 'error' && session.error && (
            <div className="notification-detail-error-container">
              <button
                className="notification-detail-error-summary"
                onClick={() => setErrorExpanded(!errorExpanded)}
                type="button"
              >
                <span className="notification-detail-error-summary-text">
                  {errorExpanded ? 'Hide Details' : getErrorSummary()}
                </span>
                {errorExpanded ? <ChevronUp size="xs" /> : <ChevronDown size="xs" />}
              </button>
              {errorExpanded && (
                <div className="notification-detail-error-expanded">
                  <pre>{session.error}</pre>
                </div>
              )}
            </div>
          )}
        </div>
        <IconButton
          icon={<Close size="sm" />}
          onClick={onClose}
          title="Close"
          size="sm"
          variant="ghost"
        />
      </div>

      {/* User Input Section */}
      {session.retryContext?.formState && (
        <div className="notification-detail-user-input">
          <div className="notification-detail-user-input-label">Request</div>
          <div className="notification-detail-user-input-content">
            {(session.retryContext.formState as Record<string, any>).userRequest ||
             (session.retryContext.formState as Record<string, any>).userInput ||
             '(No input)'}
          </div>
        </div>
      )}

      {/* Pending Confirmation - FunctionCallCard */}
      {session.status === 'pending_confirmation' && pendingEditCards.length > 0 && (
        <div className="notification-detail-pending-confirmation">
          <FunctionCallCard
            mode="pending"
            cards={pendingEditCards}
            projectId={projectId ?? ''}
            onConfirm={handleConfirmFunctionCalls}
            isApplyDisabled={isApplying}
            applyDisabledReason={isApplying ? 'Applying...' : undefined}
          />
        </div>
      )}

      {/* Function Call Results Section */}
      {session.functionCallResults && session.functionCallResults.results.length > 0 && (
        <div className="notification-detail-function-results">
          <div className="notification-detail-function-results-header">
            <span className="notification-detail-function-results-title">
              Function Calls ({session.functionCallResults.total})
            </span>
            <div className="notification-detail-function-results-summary">
              {session.functionCallResults.successCount > 0 && (
                <span className="function-results-count function-results-count--success">
                  {session.functionCallResults.successCount} succeeded
                </span>
              )}
              {session.functionCallResults.failureCount > 0 && (
                <span className="function-results-count function-results-count--failed">
                  {session.functionCallResults.failureCount} failed
                </span>
              )}
              {session.functionCallResults.rejectedCount > 0 && (
                <span className="function-results-count function-results-count--rejected">
                  {session.functionCallResults.rejectedCount} rejected
                </span>
              )}
            </div>
          </div>
          <div className="notification-detail-function-results-list">
            {session.functionCallResults.results.map((result) => (
              <FunctionCallResultItem
                key={result.functionCallId}
                result={result}
                defaultExpanded={!result.success}
              />
            ))}
          </div>
        </div>
      )}

      {/* Fixed Progress */}
      {session.progress && (
        <div className="notification-detail-progress">
          <div className="notification-detail-progress-text">
            {session.progress.currentItemLabel || `${session.progress.current} / ${session.progress.total}`}
          </div>
          <NotificationProgressBar current={session.progress.current} total={session.progress.total} />
        </div>
      )}

      {/* Scrollable Body */}
      <div className="notification-detail-body">
        {/* Thinking Display */}
        {hasThinking && session.contentParts && (
          <div className="notification-detail-thinking">
            <ThinkingDisplay
              messageId={session.id}
              contentParts={session.contentParts}
              displayMode="separate"
              isStreaming={session.status === 'running'}
            />
          </div>
        )}

        {/* Streaming Content - Mixed Text/JSON */}
        {contentSegments.length > 0 && (
          <div className="notification-detail-stream">
            <div className="notification-detail-stream-label">Output</div>
            <div className="notification-detail-segments">
              {contentSegments.map((segment, index) => {
                const isLastSegment = index === contentSegments.length - 1;
                const isStreaming = session.status === 'running';

                if (segment.type === 'json' && segment.parsed) {
                  return (
                    <JsonObjectViewer
                      key={index}
                      data={segment.parsed}
                      isStreaming={isLastSegment && isStreaming}
                    />
                  );
                }

                // Text segment
                return (
                  <div key={index} className="notification-detail-text-segment">
                    {segment.content}
                    {isLastSegment && isStreaming && (
                      <span className="notification-detail-cursor">|</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No content yet - only for running state */}
        {!hasContent && session.status === 'running' && (
          <div className="notification-detail-waiting">
            <div className="notification-detail-waiting-spinner" />
            <span>Waiting for response...</span>
          </div>
        )}

        {/* No content for error state */}
        {!hasContent && session.status === 'error' && (
          <div className="notification-detail-no-content">
            <span>No output was generated before the error occurred.</span>
          </div>
        )}

        {/* Debug Information - shown for completed/error states */}
        {(session.status === 'success' || session.status === 'error') &&
         (session.provider || session.model || session.usage) && (
          <div className="notification-detail-metadata">
            <div className="notification-detail-metadata-header">Debug Information</div>
            <div className="notification-detail-metadata-grid">
              {session.provider && (
                <div className="notification-detail-metadata-item">
                  <span className="label">Provider</span>
                  <span className="value">{session.provider}</span>
                </div>
              )}
              {session.model && (
                <div className="notification-detail-metadata-item">
                  <span className="label">Model</span>
                  <span className="value">{session.model}</span>
                </div>
              )}
              {session.usage && (
                <>
                  <div className="notification-detail-metadata-item">
                    <span className="label">Prompt Tokens</span>
                    <span className="value">{session.usage.prompt_tokens.toLocaleString()}</span>
                  </div>
                  <div className="notification-detail-metadata-item">
                    <span className="label">Completion Tokens</span>
                    <span className="value">{session.usage.completion_tokens.toLocaleString()}</span>
                  </div>
                  <div className="notification-detail-metadata-item">
                    <span className="label">Total Tokens</span>
                    <span className="value">{session.usage.total_tokens.toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default React.memo(NotificationDetailModal);
