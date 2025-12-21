import React from 'react';
import type { FunctionCallProgressStatus } from '../../llm/requestTypes';
import { StatusBadge } from './StatusBadge';
import { MODE_TITLES } from './constants';
import type { CardMode } from './types';
import { Expand, Collapse } from '../icons';

interface FunctionCallCardHeaderProps {
  mode: CardMode;
  isExpanded: boolean;
  onToggleExpand: () => void;
  itemCount: number;
  streamingStatus?: FunctionCallProgressStatus;
}

export const FunctionCallCardHeader: React.FC<FunctionCallCardHeaderProps> = ({
  mode,
  isExpanded,
  onToggleExpand,
  itemCount,
  streamingStatus,
}) => {
  const { eyebrow, title } = MODE_TITLES[mode];
  const badgeVariant = mode === 'streaming' && streamingStatus ? streamingStatus : mode;

  return (
    <div
      className="fc-header"
      onClick={onToggleExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand();
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
    >
      <div className="fc-header__text">
        <span className="fc-header__eyebrow">{eyebrow}</span>
        <span className="fc-header__title">{title}</span>
      </div>

      <div className="fc-header__meta">
        <StatusBadge variant={badgeVariant} />
        <span className="fc-header__count">{itemCount}</span>
        <span className="fc-header__toggle">
          {isExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}
        </span>
      </div>
    </div>
  );
};
