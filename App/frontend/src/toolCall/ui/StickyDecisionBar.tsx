import React from 'react';
import { TextButton } from '../../components/TextButton';
import { Close } from '../../components/icons/ui/Close';
import { Pause } from '../../components/icons/action/Pause';
import { Check } from '../../components/icons/status/Check';

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
        <TextButton size="sm" variant="danger" onClick={onRejectAll} disabled={disabled || unresolvedCount === 0} iconLeft={<Close size="sm" />} title="Reject All">
          Reject All
        </TextButton>
        {onAcceptAllAndPause && (
          <TextButton size="sm" variant="secondary" onClick={onAcceptAllAndPause} disabled={disabled || unresolvedCount === 0} iconLeft={<Pause size="sm" />} title="Apply & Pause">
            Apply & Pause
          </TextButton>
        )}
        <TextButton size="sm" variant="primary" onClick={onAcceptAll} disabled={disabled || unresolvedCount === 0} iconLeft={<Check size="sm" />} title="Accept All">
          Accept All
        </TextButton>
      </div>
    </div>
  );
};

export default StickyDecisionBar;
