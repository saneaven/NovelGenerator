import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { Close } from '../icons';
import { SUPPORTED_UI_LANGUAGES, type UILanguageCode } from '../../store/settingsStore';
import './LanguagePanel.css';

interface LanguagePanelProps {
  mainLanguage: string;
  subLanguages: string[];
  defaultSubLanguage: string | null;
  uiLanguage: UILanguageCode;
  onMainLanguageChange: (language: string) => void;
  onSubLanguagesChange: (languages: string[]) => void;
  onDefaultSubLanguageChange: (language: string | null) => void;
  onUiLanguageChange: (language: UILanguageCode) => void;
}

const LanguagePanel: React.FC<LanguagePanelProps> = ({
  mainLanguage,
  subLanguages = [],
  defaultSubLanguage,
  uiLanguage,
  onMainLanguageChange,
  onSubLanguagesChange,
  onDefaultSubLanguageChange,
  onUiLanguageChange,
}) => {
  const { t } = useTranslation();
  const [newLanguage, setNewLanguage] = useState('');

  // Ensure subLanguages is always an array (defensive guard for stale storage data)
  const safeSubLanguages = Array.isArray(subLanguages) ? subLanguages : [];

  const handleAddLanguage = () => {
    const trimmed = newLanguage.trim();
    if (!trimmed) return;
    if (safeSubLanguages.includes(trimmed)) {
      setNewLanguage('');
      return; // Already exists
    }
    if (trimmed.toLowerCase() === mainLanguage.toLowerCase()) {
      setNewLanguage('');
      return; // Can't add main language as sub
    }

    const newSubLanguages = [...safeSubLanguages, trimmed];
    onSubLanguagesChange(newSubLanguages);

    // Set as default if it's the first sub language
    if (!defaultSubLanguage) {
      onDefaultSubLanguageChange(trimmed);
    }

    setNewLanguage('');
  };

  const handleRemoveLanguage = (language: string) => {
    const newSubLanguages = safeSubLanguages.filter(l => l !== language);
    onSubLanguagesChange(newSubLanguages);

    // Update default if we removed it
    if (defaultSubLanguage === language) {
      onDefaultSubLanguageChange(newSubLanguages[0] || null);
    }
  };

  const handleSetDefault = (language: string) => {
    onDefaultSubLanguageChange(language);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLanguage();
    }
  };

  return (
    <div className="language-panel">
      <div className="panel-header">
        <h3>{t('settings.language.title')}</h3>
        <p className="panel-description">{t('settings.language.description')}</p>
      </div>

      <div className="settings-panel-card">
        <div className="form-field">
          <label>{t('settings.language.uiLanguage')}</label>
          <select
            value={uiLanguage}
            onChange={(e) => onUiLanguageChange(e.target.value as UILanguageCode)}
            className="language-select"
          >
            {SUPPORTED_UI_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
          <p className="field-hint">{t('settings.language.uiLanguageHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.language.mainLanguage')}</label>
          <input
            type="text"
            value={mainLanguage}
            onChange={(e) => onMainLanguageChange(e.target.value)}
            placeholder={t('settings.language.mainLanguagePlaceholder')}
            className="language-input"
          />
          <p className="field-hint">{t('settings.language.mainLanguageHint')}</p>
        </div>

        <div className="form-field">
          <label>{t('settings.language.subLanguages')}</label>
          <p className="field-hint" style={{ marginBottom: '8px' }}>
            {t('settings.language.subLanguagesHint')}
          </p>

          {safeSubLanguages.length > 0 && (
            <div className="sub-languages-list">
              {safeSubLanguages.map((lang) => (
                <div key={lang} className="sub-language-chip">
                  <input
                    type="radio"
                    name="defaultSubLanguage"
                    checked={defaultSubLanguage === lang}
                    onChange={() => handleSetDefault(lang)}
                    title={t('settings.language.setAsDefault')}
                    className="default-radio"
                  />
                  <span className="language-name">{lang}</span>
                  <IconButton
                    icon={<Close size="xs" />}
                    onClick={() => handleRemoveLanguage(lang)}
                    size="xs"
                    variant="ghost"
                    title={t('settings.language.removeLanguage', { language: lang })}
                    className="remove-language-btn"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="add-language-row">
            <input
              type="text"
              value={newLanguage}
              onChange={(e) => setNewLanguage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('settings.language.addLanguagePlaceholder')}
              className="language-input add-language-input"
            />
            <TextButton
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleAddLanguage}
              disabled={!newLanguage.trim()}
            >
              + {t('common.add')}
            </TextButton>
          </div>
        </div>
      </div>

      <div className="info-box">
        <h4>{t('settings.language.languageSupport')}</h4>
        <ul>
          <li>{t('settings.language.languageSupportInfo.mainLanguage')}</li>
          <li>{t('settings.language.languageSupportInfo.subLanguages')}</li>
          <li>{t('settings.language.languageSupportInfo.defaultSub')}</li>
          <li>{t('settings.language.languageSupportInfo.multilingual')}</li>
        </ul>
      </div>
    </div>
  );
};

export default LanguagePanel;
