import React from 'react';
import { TextButton } from '../../components/TextButton';

export interface StickyDecisionBarProps {
  visible: boolean;
  disabled?: boolean;
  unresolvedCount: number;
  onAcceptAll: () => void;
  onAcceptAllAndPause?: () => void;
  onRejectAll: () => void;
}

export const StickyDecisionBar: React.FC<StickyDecisionBarProps> = ({
  visible,
  disabled = false,
  unresolvedCount,
  onAcceptAll,
  onAcceptAllAndPause,
  onRejectAll,
}) => {
  if (!visible) return null;

  return (
    <div className="function-call-sticky-decision-bar" role="toolbar" aria-label="Global function call decisions">
      <span className="function-call-sticky-decision-bar__count">{unresolvedCount} pending</span>
      <div className="function-call-sticky-decision-bar__actions">
        <TextButton size="sm" variant="primary" onClick={onAcceptAll} disabled={disabled || unresolvedCount === 0}>
          Accept All
        </TextButton>
        {onAcceptAllAndPause && (
          <TextButton size="sm" variant="secondary" onClick={onAcceptAllAndPause} disabled={disabled || unresolvedCount === 0}>
            Apply & Pause
          </TextButton>
        )}
        <TextButton size="sm" variant="danger" onClick={onRejectAll} disabled={disabled || unresolvedCount === 0}>
          Reject All
        </TextButton>
      </div>
    </div>
  );
};

export default StickyDecisionBar;
