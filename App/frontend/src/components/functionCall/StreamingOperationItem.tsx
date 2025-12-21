import React from 'react';
import type { FunctionCallOperationPreview, FunctionCallProgressStatus } from '../../llm/requestTypes';
import { StatusBadge } from './StatusBadge';
import { OperationPreview } from './OperationPreview';
import { formatRelativeTime } from './constants';

interface StreamingOperationItemProps {
  functionName: string;
  status: FunctionCallProgressStatus;
  previews: FunctionCallOperationPreview[];
  updatedAt?: number;
  error?: string;
}

export const StreamingOperationItem: React.FC<StreamingOperationItemProps> = ({
  functionName,
  status,
  previews,
  updatedAt,
  error,
}) => {
  const hasPreviews = previews.length > 0;
  const isError = status === 'error';

  return (
    <div className={`fc-item fc-item--streaming fc-item--${status}`}>
      <div className="fc-item__header">
        <span className="fc-item__title">{functionName}</span>
        <div className="fc-item__meta">
          <StatusBadge variant={status} />
          {updatedAt && (
            <span className="fc-item__time">{formatRelativeTime(updatedAt)}</span>
          )}
        </div>
      </div>

      {error && (
        <div className="fc-item__error">
          Parsing in progress...
        </div>
      )}

      {hasPreviews && (
        <div className="fc-item__previews">
          {previews.map((preview, idx) => (
            <OperationPreview key={preview.key || idx} preview={preview} />
          ))}
        </div>
      )}

      {!hasPreviews && !isError && (
        <div className="fc-item__placeholder">
          Waiting for structured data...
        </div>
      )}
    </div>
  );
};
