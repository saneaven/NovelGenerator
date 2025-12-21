import React, { useCallback } from 'react';
import type { FunctionCallOperationPreview } from '../../llm/requestTypes';
import { SelectionIndicator } from './SelectionIndicator';
import { OperationPreview } from './OperationPreview';
import { Warning } from '../icons';

interface PendingOperationItemProps {
  id: string;
  title: string;
  previews: FunctionCallOperationPreview[];
  isSelected: boolean;
  onToggle: () => void;
  hasError?: boolean;
  errorMessage?: string;
  isDisabled?: boolean;
}

export const PendingOperationItem: React.FC<PendingOperationItemProps> = ({
  id,
  title,
  previews,
  isSelected,
  onToggle,
  hasError = false,
  errorMessage,
  isDisabled = false,
}) => {
  const canToggle = !hasError && !isDisabled;

  const handleClick = useCallback(() => {
    if (canToggle) {
      onToggle();
    }
  }, [canToggle, onToggle]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && canToggle) {
        e.preventDefault();
        onToggle();
      }
    },
    [canToggle, onToggle]
  );

  const indicatorState = hasError
    ? 'disabled'
    : isSelected
    ? 'selected'
    : 'unselected';

  const itemClasses = [
    'fc-item',
    'fc-item--pending',
    isSelected && 'fc-item--selected',
    !isSelected && !hasError && 'fc-item--unselected',
    hasError && 'fc-item--error',
    isDisabled && 'fc-item--disabled',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={itemClasses}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="checkbox"
      aria-checked={isSelected}
      aria-disabled={!canToggle}
      tabIndex={canToggle ? 0 : -1}
    >
      <SelectionIndicator state={indicatorState} />

      <div className="fc-item__content">
        <div className="fc-item__header">
          <span className="fc-item__title">{title}</span>
        </div>

        {hasError && errorMessage && (
          <div className="fc-item__error-banner">
            <Warning size="sm" />
            <span>{errorMessage}</span>
          </div>
        )}

        {previews.length > 0 && (
          <div className="fc-item__previews">
            {previews.map((preview, idx) => (
              <OperationPreview key={preview.key || idx} preview={preview} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
