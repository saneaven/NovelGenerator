import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeMode } from '../../store/settingsStore';
import { Sun, Moon, Computer, Lightbulb, Check } from '../icons';
import './ThemePanel.css';

interface ThemePanelProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const ThemePanel: React.FC<ThemePanelProps> = ({ theme, onThemeChange }) => {
  const { t } = useTranslation();

  return (
    <div className="theme-panel">
      <div className="panel-header">
        <h3>{t('settings.theme.title')}</h3>
        <p className="panel-description">{t('settings.theme.description')}</p>
      </div>

      <div className="settings-panel-card">
        <div className="form-field">
          <label>{t('settings.theme.themePreference')}</label>

          <div className="theme-options">
            {/* Light Mode Option */}
            <button
              type="button"
              className={`theme-option ${theme === 'light' ? 'active' : ''}`}
              onClick={() => onThemeChange('light')}
            >
              <div className="theme-option-icon"><Sun size="xl" /></div>
              <div className="theme-option-content">
                <div className="theme-option-title">{t('settings.theme.light')}</div>
                <div className="theme-option-description">{t('settings.theme.lightDescription')}</div>
              </div>
              {theme === 'light' && <div className="theme-option-check"><Check size="md" /></div>}
            </button>

            {/* Dark Mode Option */}
            <button
              type="button"
              className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => onThemeChange('dark')}
            >
              <div className="theme-option-icon"><Moon size="xl" /></div>
              <div className="theme-option-content">
                <div className="theme-option-title">{t('settings.theme.dark')}</div>
                <div className="theme-option-description">{t('settings.theme.darkDescription')}</div>
              </div>
              {theme === 'dark' && <div className="theme-option-check"><Check size="md" /></div>}
            </button>

            {/* System Auto Option */}
            <button
              type="button"
              className={`theme-option ${theme === 'system' ? 'active' : ''}`}
              onClick={() => onThemeChange('system')}
            >
              <div className="theme-option-icon"><Computer size="xl" /></div>
              <div className="theme-option-content">
                <div className="theme-option-title">{t('settings.theme.system')}</div>
                <div className="theme-option-description">{t('settings.theme.systemDescription')}</div>
              </div>
              {theme === 'system' && <div className="theme-option-check"><Check size="md" /></div>}
            </button>
          </div>
        </div>
      </div>

      <div className="info-box">
        <h4><Lightbulb size="md" /> {t('settings.theme.aboutThemes')}</h4>
        <ul>
          <li>
            <strong>{t('settings.theme.light')}:</strong> {t('settings.theme.lightInfo')}
          </li>
          <li>
            <strong>{t('settings.theme.dark')}:</strong> {t('settings.theme.darkInfo')}
          </li>
          <li>
            <strong>{t('settings.theme.system')}:</strong> {t('settings.theme.systemInfo')}
          </li>
          <li>{t('settings.theme.instantChange')}</li>
        </ul>
      </div>
    </div>
  );
};

export default ThemePanel;
