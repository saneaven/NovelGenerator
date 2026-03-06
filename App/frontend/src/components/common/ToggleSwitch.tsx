import React from 'react';
import './ToggleSwitch.css';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  mode?: 'default' | 'bare';
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  icon,
  disabled = false,
  mode = 'default',
}) => {
  const bare = mode === 'bare';
  const cls = `toggle-switch ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${bare ? 'mode-bare' : ''}`;

  if (bare) {
    return (
      <span className={cls}>
        <label className="toggle-switch-track">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <div className="toggle-switch-thumb" />
        </label>
      </span>
    );
  }

  return (
    <label className={cls}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className="toggle-switch-content">
        <div className="toggle-switch-label">
          {icon != null && <span className="toggle-switch-icon">{icon}</span>}
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
