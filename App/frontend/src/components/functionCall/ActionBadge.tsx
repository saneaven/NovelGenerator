import React from 'react';
import { ACTION_LABELS, TYPE_LABELS, humanize } from './constants';

interface ActionBadgeProps {
  action?: string;
  type?: string;
  className?: string;
}

export const ActionBadge: React.FC<ActionBadgeProps> = ({ action, type, className = '' }) => {
  const actionLabel = action ? ACTION_LABELS[action] ?? humanize(action) : 'Action';
  const typeLabel = type ? TYPE_LABELS[type] ?? humanize(type) : '';

  return (
    <div className={`fc-action-badges ${className}`}>
      <span className={`fc-action-badge fc-action-badge--${action || 'default'}`}>
        {actionLabel}
      </span>
      {typeLabel && <span className="fc-type-label">{typeLabel}</span>}
    </div>
  );
};
