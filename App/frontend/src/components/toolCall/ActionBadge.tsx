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
    <div className={`tool-call-action-badges ${className}`}>
      <span className={`tool-call-action-badge tool-call-action-badge--${action || 'default'}`}>
        {actionLabel}
      </span>
      {typeLabel && <span className="tool-call-type-label">{typeLabel}</span>}
    </div>
  );
};
