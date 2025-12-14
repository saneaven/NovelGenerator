import React from 'react';
import type { ThemeMode } from '../../store/settingsStore';
import { Sun, Moon, Computer, Lightbulb, Check } from '../icons';
import './ThemePanel.css';

interface ThemePanelProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const ThemePanel: React.FC<ThemePanelProps> = ({ theme, onThemeChange }) => {
  return (
    <div className="theme-panel">
      <div className="panel-description">
        <p>
          Choose your preferred color scheme for the application interface. Dark mode can reduce eye strain
          in low-light environments.
        </p>
      </div>

      <div className="theme-settings-card">
        <div className="form-field">
          <label>Theme Preference</label>

          <div className="theme-options">
            {/* Light Mode Option */}
            <button
              type="button"
              className={`theme-option ${theme === 'light' ? 'active' : ''}`}
              onClick={() => onThemeChange('light')}
            >
              <div className="theme-option-icon"><Sun size={20} /></div>
              <div className="theme-option-content">
                <div className="theme-option-title">Light</div>
                <div className="theme-option-description">Bright and clean interface</div>
              </div>
              {theme === 'light' && <div className="theme-option-check"><Check size={16} /></div>}
            </button>

            {/* Dark Mode Option */}
            <button
              type="button"
              className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => onThemeChange('dark')}
            >
              <div className="theme-option-icon"><Moon size={20} /></div>
              <div className="theme-option-content">
                <div className="theme-option-title">Dark</div>
                <div className="theme-option-description">Easy on the eyes in low light</div>
              </div>
              {theme === 'dark' && <div className="theme-option-check"><Check size={16} /></div>}
            </button>

            {/* System Auto Option */}
            <button
              type="button"
              className={`theme-option ${theme === 'system' ? 'active' : ''}`}
              onClick={() => onThemeChange('system')}
            >
              <div className="theme-option-icon"><Computer size={20} /></div>
              <div className="theme-option-content">
                <div className="theme-option-title">System</div>
                <div className="theme-option-description">Match your OS preference</div>
              </div>
              {theme === 'system' && <div className="theme-option-check"><Check size={16} /></div>}
            </button>
          </div>
        </div>
      </div>

      <div className="theme-info-box">
        <h4><Lightbulb size={16} /> About Themes</h4>
        <ul>
          <li>
            <strong>Light:</strong> Traditional bright interface, great for well-lit environments
          </li>
          <li>
            <strong>Dark:</strong> Reduces eye strain and saves battery on OLED screens
          </li>
          <li>
            <strong>System:</strong> Automatically switches based on your operating system settings
          </li>
          <li>Theme changes apply immediately without reloading the page</li>
        </ul>
      </div>
    </div>
  );
};

export default ThemePanel;
