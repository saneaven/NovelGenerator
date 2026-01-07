import React, { useCallback } from 'react';
import { ChevronDown } from '../icons';
import { ActionBadge } from './ActionBadge';
import { OperationDetails } from './OperationDetails';
import type { CardMode } from './types';

type StreamingStatus = 'collecting' | 'validating' | 'ready' | 'error';
type CallStatus = 'validating' | 'pending' | 'failed' | 'accepted' | 'rejected';

type StatusVariant = StreamingStatus | CallStatus;

function statusLabel(variant: StatusVariant): string {
  switch (variant) {
    case 'collecting':
      return 'Streaming';
    case 'validating':
      return 'Validating';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    case 'pending':
      return 'Pending';
    case 'accepted':
      return 'Applied';
    case 'rejected':
      return 'Skipped';
    case 'failed':
      return 'Failed';
    default:
      return variant;
  }
}

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
}) => {
  const panelId = `fc-op-panel-${id}`;

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
    <div className={`fc-op fc-op--${mode} ${isExpanded ? 'fc-op--expanded' : ''}`}>
      <button
        type="button"
        className="fc-op__header"
        onClick={handleHeaderClick}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        {showCheckbox && (
          <input
            type="checkbox"
            className="fc-op__checkbox"
            checked={isSelected}
            disabled={isCheckboxDisabled}
            onClick={handleCheckboxClick}
            onChange={handleCheckboxChange}
          />
        )}

        <div className="fc-op__left">
          <ActionBadge action={action} type={type} />
          <div className="fc-op__label">{label}</div>
        </div>

        <div className="fc-op__right">
          {status && (
            <span className={`fc-pill fc-pill--${status}`}>
              {statusLabel(status)}
            </span>
          )}
          <ChevronDown className={`fc-op__chevron ${isExpanded ? 'fc-op__chevron--open' : ''}`} size="sm" />
        </div>
      </button>

      {isExpanded && (
        <div id={panelId} className="fc-op__details" role="region">
          <OperationDetails data={detailsData} rawText={rawText} errorMessage={errorMessage} />
        </div>
      )}
    </div>
  );
};

