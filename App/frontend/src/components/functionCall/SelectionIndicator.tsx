import React from 'react';
import { Check, Close } from '../icons';

export type IndicatorState = 'selected' | 'unselected' | 'applied' | 'rejected' | 'disabled' | 'failed';

interface SelectionIndicatorProps {
  state: IndicatorState;
  className?: string;
}

export const SelectionIndicator: React.FC<SelectionIndicatorProps> = ({ state, className = '' }) => {
  const showCheck = state === 'selected' || state === 'applied';
  const showX = state === 'rejected' || state === 'failed';

  return (
    <div className={`fc-indicator fc-indicator--${state} ${className}`}>
      {showCheck && <Check size="xs" />}
      {showX && <Close size="xs" />}
    </div>
  );
};
