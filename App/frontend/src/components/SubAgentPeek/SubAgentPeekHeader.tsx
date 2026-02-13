import React from 'react';
import { ChevronDown } from '../icons';

export interface SubAgentPeekHeaderItem {
  key: string;
  displayName: string;
  status: string;
  pendingCount: number;
  selected: boolean;
}

export interface SubAgentPeekHeaderProps {
  open: boolean;
  onToggle: () => void;
  items: SubAgentPeekHeaderItem[];
  onSelect: (runKey: string) => void;
}

function statusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'sub-agent-peek-header__status--running';
    case 'waiting':
    case 'paused':
      return 'sub-agent-peek-header__status--pending';
    case 'completed':
      return 'sub-agent-peek-header__status--accepted';
    case 'cancelled':
      return 'sub-agent-peek-header__status--rejected';
    case 'error':
      return 'sub-agent-peek-header__status--failed';
    default:
      return 'sub-agent-peek-header__status--pending';
  }
}

export const SubAgentPeekHeader: React.FC<SubAgentPeekHeaderProps> = ({
  open,
  onToggle,
  items,
  onSelect,
}) => {
  const selected = items.find((item) => item.selected) ?? items[0];

  return (
    <div className="sub-agent-peek-header">
      <button
        type="button"
        className="sub-agent-peek-header__main"
        onClick={onToggle}
        aria-expanded={open}
      >
        <div className="sub-agent-peek-header__left">
          <h4 className="sub-agent-peek-header__title">Sub-agent Peek</h4>
          {selected && (
            <span className={`sub-agent-peek-header__status ${statusClass(selected.status)}`}>
              {selected.status}
            </span>
          )}
        </div>
        <ChevronDown
          size="sm"
          className={`sub-agent-peek-header__chevron${open ? ' sub-agent-peek-header__chevron--open' : ''}`}
        />
      </button>

      {items.length > 1 && (
        <div className="sub-agent-peek-header__switches" role="tablist" aria-label="Sub-agent run switch">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`sub-agent-peek-switch${item.selected ? ' sub-agent-peek-switch--active' : ''}`}
              onClick={() => onSelect(item.key)}
              role="tab"
              aria-selected={item.selected}
            >
              <span className="sub-agent-peek-switch__label">{item.displayName}</span>
              {item.pendingCount > 0 && (
                <span
                  className="sub-agent-peek-switch__badge"
                  aria-label={`${item.pendingCount} pending decision${item.pendingCount === 1 ? '' : 's'}`}
                >
                  {item.pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SubAgentPeekHeader;
