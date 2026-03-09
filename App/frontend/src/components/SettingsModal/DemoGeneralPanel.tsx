import React from 'react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../common/ToggleSwitch';
import './DemoGeneralPanel.css';

interface DemoGeneralPanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

const LOCKED_FEATURE_KEYS = [
  'credentials',
  'prompts',
  'searchMemory',
  'imageGen',
  'advanced',
] as const;

const DemoGeneralPanel: React.FC<DemoGeneralPanelProps> = ({ enabled, onEnabledChange }) => {
  const { t } = useTranslation();

  return (
    <div className="demo-general-panel">
      <div className="panel-header">
        <h3>{t('settings.general.title')}</h3>
        <p className="panel-description">{t('settings.general.description')}</p>
      </div>

      <section className="demo-general-panel__card">
        <div className="demo-general-panel__badge">{t('settings.general.demo.badge')}</div>
        <h4>{t('settings.general.demo.title')}</h4>
        <p>{t('settings.general.demo.description')}</p>
        <p>{t('settings.general.demo.unlockHint')}</p>

        <div className="demo-general-panel__locked">
          <h5>{t('settings.general.demo.lockedTitle')}</h5>
          <ul>
            {LOCKED_FEATURE_KEYS.map((key) => (
              <li key={key}>{t(`settings.general.demo.lockedFeatures.${key}`)}</li>
            ))}
          </ul>
        </div>

        <div className="demo-general-panel__toggle-row">
          <ToggleSwitch
            checked={enabled}
            onChange={onEnabledChange}
            label={t('settings.general.demo.toggleLabel')}
          />
          <p className="demo-general-panel__toggle-hint">{t('settings.general.demo.toggleHint')}</p>
        </div>

        <p className="demo-general-panel__footnote">{t('settings.general.demo.editableHint')}</p>
      </section>
    </div>
  );
};

export default DemoGeneralPanel;
