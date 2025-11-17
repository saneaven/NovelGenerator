import React, { useEffect, useMemo, useState } from 'react';
import type {
  FunctionCallOperationPreview,
  FunctionCallProgress,
} from '../../llm_request/types';
import './FunctionCallReviewCard.css';

type ReviewStatus = FunctionCallProgress['status'] | 'pending' | 'applied';
type ReviewVariant = 'streaming' | 'pending';

interface FunctionCallReviewCardProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  status?: ReviewStatus;
  updatedAt?: number;
  operations: FunctionCallOperationPreview[];
  placeholder?: string;
  error?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: ReviewVariant;
}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  collecting: 'Collecting',
  validating: 'Validating',
  ready: 'Ready',
  error: 'Error',
  pending: 'Pending',
  applied: 'Applied',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

const TYPE_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
  act: 'Act',
  chapter: 'Chapter',
};

const FunctionCallReviewCard: React.FC<FunctionCallReviewCardProps> = ({
  title,
  eyebrow,
  subtitle,
  status = 'pending',
  updatedAt,
  operations,
  placeholder = 'Waiting for structured preview…',
  error,
  collapsible,
  defaultOpen = false,
  actions,
  footer,
  variant = 'pending',
}) => {
  const statusLabel = STATUS_LABELS[status] ?? status;
  const [isExpanded, setIsExpanded] = useState(defaultOpen);

  useEffect(() => {
    setIsExpanded(defaultOpen);
  }, [defaultOpen]);

  const renderOperations = () => {
    if (!operations.length) {
      return <div className="fcrc-placeholder">{placeholder}</div>;
    }

    return (
      <div className="fcrc-operation-list">
        {operations.map((operation, index) => (
          <OperationRow
            key={resolveOperationKey(operation, index)}
            operation={operation}
          />
        ))}
      </div>
    );
  };

  const content = collapsible ? (
    <details
      className="fcrc-collapsible"
      open={isExpanded}
      onToggle={(event) => setIsExpanded((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        Preview Details
        {operations.length > 0 && (
          <span className="fcrc-count">
            {operations.length} {operations.length === 1 ? 'item' : 'items'}
          </span>
        )}
      </summary>
      {renderOperations()}
    </details>
  ) : (
    renderOperations()
  );

  return (
    <div className={`function-call-review-card function-call-review-card--${variant} status-${status}`}>
      <div className="fcrc-header">
        <div className="fcrc-header-text">
          {eyebrow && <div className="fcrc-eyebrow">{eyebrow}</div>}
          <div className="fcrc-title">{title}</div>
          {subtitle && <p className="fcrc-subtitle">{subtitle}</p>}
        </div>
        <div className="fcrc-meta">
          {statusLabel && <span className="fcrc-status">{statusLabel}</span>}
          {updatedAt && <span className="fcrc-updated">{formatRelativeTime(updatedAt)}</span>}
        </div>
      </div>

      {error && <div className="fcrc-error">{error}</div>}

      {content}

      {actions && <div className="fcrc-actions">{actions}</div>}
      {footer && <div className="fcrc-footer">{footer}</div>}
    </div>
  );
};

interface OperationRowProps {
  operation: FunctionCallOperationPreview;
}

const OperationRow: React.FC<OperationRowProps> = ({ operation }) => {
  const actionLabel = operation.action ? ACTION_LABELS[operation.action] ?? humanize(operation.action) : 'Action';
  const typeLabel = operation.type ? TYPE_LABELS[operation.type] ?? humanize(operation.type) : '';
  const headline = operation.targetName || typeLabel || actionLabel;
  const subline = operation.summary || '';
  const missingFieldsLabel = operation.missingFields?.length
    ? `Need: ${operation.missingFields.map(humanize).join(', ')}`
    : '';

  return (
    <div className="fcrc-operation-row">
      <div className="fcrc-operation-meta">
        <span className={`fcrc-operation-action action-${operation.action || 'pending'}`}>{actionLabel}</span>
        {typeLabel && <span className="fcrc-operation-type">{typeLabel}</span>}
      </div>
      <div className="fcrc-operation-headline">{headline}</div>
      {subline && <div className="fcrc-operation-subline">{subline}</div>}
      {missingFieldsLabel && <div className="fcrc-operation-missing">{missingFieldsLabel}</div>}
      {operation.chapters && operation.chapters.length > 0 && (
        <div className="fcrc-operation-children">
          <div className="fcrc-operation-children-title">Chapters</div>
          <div className="fcrc-operation-children-list">
            {operation.chapters.map((chapter, index) => (
              <div
                key={chapter.name || `chapter-${index}`}
                className="fcrc-operation-child"
              >
                <div className="fcrc-operation-child-title">
                  {chapter.name || `Chapter ${index + 1}`}
                </div>
                {chapter.description && (
                  <div className="fcrc-operation-child-summary">{chapter.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const resolveOperationKey = (operation: FunctionCallOperationPreview, index: number) => {
  const key = operation.key;
  if (key && key !== 'null' && key !== 'undefined') {
    return key;
  }
  return `${operation.type ?? 'operation'}-${index}`;
};

const humanize = (value?: string) => {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/g, (char) => char.toUpperCase());
};

const formatRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  if (Number.isNaN(diff)) return '';
  if (diff < 5_000) return 'Just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default FunctionCallReviewCard;
