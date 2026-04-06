import React, { useCallback } from 'react';
import './TriStateToggle.css';

export type TriStateValue = true | false | undefined;

interface TriStateToggleProps {
  value: TriStateValue;
  onChange: (value: TriStateValue) => void;
  disabled?: boolean;
  labels?: { on?: string; off?: string; default?: string };
}

function stateClass(value: TriStateValue): string {
  if (value === true) return 'tri-state-toggle--on';
  if (value === false) return 'tri-state-toggle--off';
  return 'tri-state-toggle--default';
}

const TriStateToggle: React.FC<TriStateToggleProps> = ({
  value,
  onChange,
  disabled = false,
  labels,
}) => {
  const handleClick = useCallback(() => {
    if (disabled) return;
    // Cycle: Off → Default → On → Off
    if (value === false) onChange(undefined);
    else if (value === undefined) onChange(true);
    else onChange(false);
  }, [disabled, value, onChange]);

  const cls = [
    'tri-state-toggle',
    stateClass(value),
    disabled ? 'tri-state-toggle--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <div className="tri-state-toggle__track" onClick={handleClick}>
        <div className="tri-state-toggle__thumb" />
      </div>
      <div className="tri-state-toggle__labels">
        <span>{labels?.off ?? 'Off'}</span>
        <span>{labels?.default ?? 'Default'}</span>
        <span>{labels?.on ?? 'On'}</span>
      </div>
    </div>
  );
};

export default TriStateToggle;
