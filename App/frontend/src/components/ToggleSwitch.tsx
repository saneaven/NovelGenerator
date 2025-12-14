import React from 'react';
import './ToggleSwitch.css';
import { Clipboard } from './icons';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  icon = <Clipboard size={14} />,
  disabled = false,
}) => {
  return (
    <label className={`toggle-switch ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className="toggle-switch-content">
        <div className="toggle-switch-label">
          <span className="toggle-switch-icon">{icon}</span>
          <span className="toggle-switch-text">{label}</span>
        </div>
        <div className="toggle-switch-track">
          <div className="toggle-switch-thumb" />
        </div>
      </div>
    </label>
  );
};

export default ToggleSwitch;
