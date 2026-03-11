import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from '../../components/icons';
import { TextButton } from '../../components/TextButton';
import type { HeaderStatus, OperationCategory } from './vmTypes';

const STATUS_LABEL_KEYS: Record<HeaderStatus, string> = {
  collecting: 'operationStatus.streaming',
  validating: 'operationStatus.validating',
  pending: 'operationStatus.pending',
  processing: 'operationStatus.processing',
  working: 'operationStatus.working',
  streaming: 'operationStatus.running',
  applied: 'operationStatus.applied',
  rejected: 'operationStatus.rejected',
  failed: 'operationStatus.failed',
};

const CATEGORY_LABELS: Record<OperationCategory, string> = {
  read: 'READ',
  create: 'CREATE',
  replace: 'REPLACE',
  patch: 'PATCH',
  delete: 'DELETE',
  translate: 'TRANSLATE',
  patch_translation: 'PATCH TRANSLATION',
  search: 'SEARCH',
  call: 'CALL',
  generate: 'GENERATE',
};

export interface FunctionCallHeaderIslandProps {
  cardId: string;
  category: OperationCategory;
  status: HeaderStatus;
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  canToggle?: boolean;

  showDecisionButtons?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  decisionDisabled?: boolean;

  rightActions?: React.ReactNode;
}

export const FunctionCallHeaderIsland: React.FC<FunctionCallHeaderIslandProps> = ({
  cardId,
  category,
  status,
  title,
  subtitle,
  expanded,
  onToggle,
  canToggle = true,
  showDecisionButtons = false,
  onAccept,
  onReject,
  decisionDisabled = false,
  rightActions,
}) => {
  const { t } = useTranslation();
  const panelId = `function-call-card-panel-${cardId}`;

  const statusKey = STATUS_LABEL_KEYS[status];
  const translatedStatus = t(statusKey);
  const statusLabel = translatedStatus === statusKey ? status : translatedStatus;

  const handleAccept = useCallback(() => {
    if (decisionDisabled) return;
    onAccept?.();
  }, [decisionDisabled, onAccept]);

  const handleReject = useCallback(() => {
    if (decisionDisabled) return;
    onReject?.();
  }, [decisionDisabled, onReject]);

  return (
    <div
      className={`function-call-header-island function-call-header-island--${category}`}
    >
      <button
        type="button"
        className="function-call-header-island__toggle"
        onClick={canToggle ? onToggle : undefined}
        aria-disabled={!canToggle}
        aria-expanded={canToggle ? expanded : undefined}
        aria-controls={canToggle ? panelId : undefined}
      >
        <div className="function-call-header-island__left">
          <div className="function-call-header-island__title-row">
            <span className="function-call-header-island__kind">{CATEGORY_LABELS[category]}</span>
            <h4 className="function-call-header-island__title">{title}</h4>
            <span className={`function-call-status-pill function-call-status-pill--${status}`}>{statusLabel}</span>
          </div>
          {subtitle && <p className="function-call-header-island__subtitle">{subtitle}</p>}
        </div>
      </button>

      <div className="function-call-header-island__right">
        {showDecisionButtons && (
          <div className="function-call-header-island__decision-buttons">
            <TextButton size="sm" variant="primary" onClick={handleAccept} disabled={decisionDisabled}>
              {t('toolCall.accept')}
            </TextButton>
            <TextButton size="sm" variant="danger" onClick={handleReject} disabled={decisionDisabled}>
              {t('toolCall.reject')}
            </TextButton>
          </div>
        )}
        {rightActions}
        {canToggle && (
          <button
            type="button"
            className="function-call-header-island__chevron-btn"
            onClick={onToggle}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            <ChevronDown
              size="sm"
              className={`function-call-header-island__chevron${expanded ? ' function-call-header-island__chevron--open' : ''}`}
            />
          </button>
        )}
      </div>
    </div>
  );
};

export default FunctionCallHeaderIsland;
