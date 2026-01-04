import React from 'react';
import { Warning } from '../icons';

interface CardFooterProps {
  selectedCount: number;
  rejectedCount: number;
  totalCount: number;
  isApplyDisabled: boolean;
  applyDisabledReason?: string;
  isConfirming: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirm: () => void;
}

export const CardFooter: React.FC<CardFooterProps> = ({
  selectedCount,
  rejectedCount,
  totalCount,
  isApplyDisabled,
  applyDisabledReason,
  isConfirming,
  onSelectAll,
  onDeselectAll,
  onConfirm,
}) => {
  const allSelected = selectedCount === totalCount;

  return (
    <div className="fc-footer">
      <div className="fc-footer__summary">
        <span className="fc-footer__selected">
          {selectedCount} of {totalCount} selected
        </span>
        {rejectedCount > 0 && (
          <span className="fc-footer__rejected">
            ({rejectedCount} will be skipped)
          </span>
        )}
      </div>

      {isApplyDisabled && applyDisabledReason && (
        <div className="fc-footer__warning">
          <Warning size="sm" />
          <span>{applyDisabledReason}</span>
        </div>
      )}

      <div className="fc-footer__actions">
        <div className="fc-footer__bulk">
          <button
            type="button"
            className="fc-btn fc-btn--ghost"
            onClick={onSelectAll}
            disabled={allSelected || isConfirming || isApplyDisabled}
          >
            Select All
          </button>
          <button
            type="button"
            className="fc-btn fc-btn--ghost"
            onClick={onDeselectAll}
            disabled={isConfirming || isApplyDisabled}
          >
            Deselect All
          </button>
        </div>
        <button
          type="button"
          className="fc-btn fc-btn--primary"
          onClick={onConfirm}
          disabled={isConfirming || isApplyDisabled}
        >
          {isConfirming ? 'Applying...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
};
