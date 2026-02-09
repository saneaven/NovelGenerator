import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from '../icons';
import { TextButton } from '../TextButton';
import { ActionBadge } from './ActionBadge';
import { OperationDetails } from './OperationDetails';
import type { CardMode } from './types';
import type { ApplicationResult, ToolCallDecision } from '../../toolCall/types';

type StreamingStatus = 'collecting' | 'validating' | 'ready' | 'error';
type CallStatus = 'validating' | 'pending' | 'running' | 'failed' | 'accepted' | 'rejected';

type StatusVariant = StreamingStatus | CallStatus;

const STATUS_LABEL_KEYS: Record<StatusVariant, string> = {
  collecting: 'operationStatus.streaming',
  validating: 'operationStatus.validating',
  ready: 'operationStatus.ready',
  error: 'operationStatus.error',
  pending: 'operationStatus.pending',
  running: 'operationStatus.running',
  accepted: 'operationStatus.applied',
  rejected: 'operationStatus.skipped',
  failed: 'operationStatus.failed',
};

export interface OperationItemProps {
  mode: CardMode;
  id: string;
  label: string;
  action?: string;
  type?: string;
  status?: StatusVariant;

  isExpanded: boolean;
  onToggle?: () => void;

  // Pending-only decision controls
  showDecisionControls?: boolean;
  decisionControlStyle?: 'toggle' | 'buttons';
  decision?: ToolCallDecision;
  isDecisionDisabled?: boolean;
  onAccept?: () => void;
  onReject?: () => void;

  // Details
  detailsData?: unknown;
  rawText?: string;
  errorMessage?: string;
  result?: ApplicationResult;
}

export const OperationItem: React.FC<OperationItemProps> = ({
  mode,
  id,
  label,
  action,
  type,
  status,
  isExpanded,
  onToggle,
  showDecisionControls = false,
  decisionControlStyle = 'toggle',
  decision = 'accept',
  isDecisionDisabled = false,
  onAccept,
  onReject,
  detailsData,
  rawText,
  errorMessage,
  result,
}) => {
  const { t } = useTranslation();
  const panelId = `tool-call-op-panel-${id}`;

  const getStatusLabel = (variant: StatusVariant): string => {
    const key = STATUS_LABEL_KEYS[variant];
    if (!key) return variant;
    const translated = t(key);
    // Fallback: when i18n key is missing, i18next typically returns the key itself.
    return translated === key ? variant : translated;
  };

  const handleHeaderClick = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  const stopHeaderToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleAccept = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDecisionDisabled) return;
    onAccept?.();
  }, [isDecisionDisabled, onAccept]);

  const handleReject = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDecisionDisabled) return;
    onReject?.();
  }, [isDecisionDisabled, onReject]);

  return (
    <div className={`tool-call-op tool-call-op--${mode} ${isExpanded ? 'tool-call-op--expanded' : ''}`}>
      <button
        type="button"
        className="tool-call-op__header"
        onClick={handleHeaderClick}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        <div className="tool-call-op__left">
          <ActionBadge action={action} type={type} />
          <div className="tool-call-op__label">{label}</div>
        </div>

        <div className="tool-call-op__right">
          {showDecisionControls && (
            <div
              className={`tool-call-op__decision${decisionControlStyle === 'buttons' ? ' tool-call-op__decision--buttons' : ''}`}
              onClick={stopHeaderToggle}
            >
              {decisionControlStyle === 'buttons' ? (
                <>
                  <TextButton
                    size="sm"
                    variant="primary"
                    onClick={handleAccept}
                    disabled={isDecisionDisabled}
                  >
                    {t('toolCall.accept')}
                  </TextButton>
                  <TextButton
                    size="sm"
                    variant="danger"
                    onClick={handleReject}
                    disabled={isDecisionDisabled}
                  >
                    {t('toolCall.reject')}
                  </TextButton>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`tool-call-decision-btn ${decision === 'accept' ? 'is-active' : ''}`}
                    onClick={handleAccept}
                    disabled={isDecisionDisabled}
                  >
                    {t('toolCall.accept')}
                  </button>
                  <button
                    type="button"
                    className={`tool-call-decision-btn ${decision === 'reject' ? 'is-active is-reject' : 'is-reject'}`}
                    onClick={handleReject}
                    disabled={isDecisionDisabled}
                  >
                    {t('toolCall.reject')}
                  </button>
                </>
              )}
            </div>
          )}
          {status && (
            <span className={`tool-call-pill tool-call-pill--${status}`}>
              {getStatusLabel(status)}
            </span>
          )}
          <ChevronDown className={`tool-call-op__chevron ${isExpanded ? 'tool-call-op__chevron--open' : ''}`} size="sm" />
        </div>
      </button>

      {isExpanded && (
        <div id={panelId} className="tool-call-op__details" role="region">
          <OperationDetails data={detailsData} rawText={rawText} errorMessage={errorMessage} result={result} />
        </div>
      )}
    </div>
  );
};
