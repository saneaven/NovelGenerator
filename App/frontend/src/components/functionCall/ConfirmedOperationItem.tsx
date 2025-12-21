import React from 'react';
import type { FunctionCallOperationPreview } from '../../llm/requestTypes';
import { SelectionIndicator, type IndicatorState } from './SelectionIndicator';
import { OperationPreview } from './OperationPreview';

type ConfirmStatus = Extract<IndicatorState, 'applied' | 'rejected' | 'failed'>;

interface ConfirmedOperationItemProps {
  title: string;
  previews: FunctionCallOperationPreview[];
  status: ConfirmStatus;
  errorMessage?: string;
}

const STATUS_LABELS: Record<ConfirmStatus, string> = {
  applied: 'Applied',
  rejected: 'Rejected',
  failed: 'Failed',
};

export const ConfirmedOperationItem: React.FC<ConfirmedOperationItemProps> = ({
  title,
  previews,
  status,
  errorMessage,
}) => {
  const itemClasses = [
    'fc-item',
    'fc-item--confirmed',
    `fc-item--${status}`,
  ].join(' ');

  return (
    <div className={itemClasses}>
      <SelectionIndicator state={status} />

      <div className="fc-item__content">
        <div className="fc-item__header">
          <span className="fc-item__title">{title}</span>
          <span className={`fc-item__result fc-item__result--${status}`}>
            {STATUS_LABELS[status]}
          </span>
        </div>

        {previews.length > 0 && (
          <div className="fc-item__previews">
            {previews.map((preview, idx) => (
              <OperationPreview key={preview.key || idx} preview={preview} compact />
            ))}
          </div>
        )}

        {status === 'failed' && errorMessage && (
          <div className="fc-item__error">{errorMessage}</div>
        )}
      </div>
    </div>
  );
};
