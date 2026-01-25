import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from '../icons';
import { ActionBadge } from './ActionBadge';
import { OperationDetails } from './OperationDetails';
import type { CardMode } from './types';
import type { ApplicationResult } from '../../toolCall/types';

type StreamingStatus = 'collecting' | 'validating' | 'ready' | 'error';
type CallStatus = 'validating' | 'pending' | 'failed' | 'accepted' | 'rejected';

type StatusVariant = StreamingStatus | CallStatus;

const STATUS_LABEL_KEYS: Record<StatusVariant, string> = {
  collecting: 'operationStatus.streaming',
  validating: 'operationStatus.validating',
  ready: 'operationStatus.ready',
  error: 'operationStatus.error',
  pending: 'operationStatus.pending',
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

  // Pending-only selection
  showCheckbox?: boolean;
  isSelected?: boolean;
  isCheckboxDisabled?: boolean;
  onToggleSelected?: () => void;

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
  showCheckbox = false,
  isSelected = true,
  isCheckboxDisabled = false,
  onToggleSelected,
  detailsData,
  rawText,
  errorMessage,
  result,
}) => {
  const { t } = useTranslation();
  const panelId = `tool-call-op-panel-${id}`;

  const getStatusLabel = (variant: StatusVariant): string => {
    const key = STATUS_LABEL_KEYS[variant];
    return key ? t(key) : variant;
  };

  const handleHeaderClick = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onToggleSelected?.();
  }, [onToggleSelected]);

  return (
    <div className={`tool-call-op tool-call-op--${mode} ${isExpanded ? 'tool-call-op--expanded' : ''}`}>
      <button
        type="button"
        className="tool-call-op__header"
        onClick={handleHeaderClick}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        {showCheckbox && (
          <input
            type="checkbox"
            className="tool-call-op__checkbox"
            checked={isSelected}
            disabled={isCheckboxDisabled}
            onClick={handleCheckboxClick}
            onChange={handleCheckboxChange}
          />
        )}

        <div className="tool-call-op__left">
          <ActionBadge action={action} type={type} />
          <div className="tool-call-op__label">{label}</div>
        </div>

        <div className="tool-call-op__right">
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
