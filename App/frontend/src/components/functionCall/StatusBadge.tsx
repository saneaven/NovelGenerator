import React from 'react';
import type { FunctionCallProgressStatus } from '../../llm/requestTypes';
import { STATUS_LABELS } from './constants';
import type { CardMode } from './types';

type BadgeVariant = FunctionCallProgressStatus | CardMode;

interface StatusBadgeProps {
  variant: BadgeVariant;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ variant, className = '' }) => {
  const label = STATUS_LABELS[variant] ?? variant;

  return (
    <span className={`fc-badge fc-badge--${variant} ${className}`}>
      {label}
    </span>
  );
};
