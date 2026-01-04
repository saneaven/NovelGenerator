import React, { useState } from 'react';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { Close } from '../icons';
import './LanguagePanel.css';

interface LanguagePanelProps {
  mainLanguage: string;
  subLanguages: string[];
  defaultSubLanguage: string | null;
  onMainLanguageChange: (language: string) => void;
  onSubLanguagesChange: (languages: string[]) => void;
  onDefaultSubLanguageChange: (language: string | null) => void;
}

const LanguagePanel: React.FC<LanguagePanelProps> = ({
  mainLanguage,
  subLanguages = [],
  defaultSubLanguage,
  onMainLanguageChange,
  onSubLanguagesChange,
  onDefaultSubLanguageChange,
}) => {
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
      <div className="panel-description">
        <p>Set your preferred languages for the application interface and content generation.</p>
      </div>

      <div className="language-settings-card">
        <div className="form-field">
          <label>Main Language</label>
          <input
            type="text"
            value={mainLanguage}
            onChange={(e) => onMainLanguageChange(e.target.value)}
            placeholder="English"
            className="language-input"
          />
          <p className="field-hint">Primary language for the application and AI responses</p>
        </div>

        <div className="form-field">
          <label>Sub Languages</label>
          <p className="field-hint" style={{ marginBottom: '8px' }}>
            Additional languages for translation features. Click the radio button to set the default for quick-translate.
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
                    title="Set as default translation language"
                    className="default-radio"
                  />
                  <span className="language-name">{lang}</span>
                  <IconButton
                    icon={<Close size="xs" />}
                    onClick={() => handleRemoveLanguage(lang)}
                    size="xs"
                    title={`Remove ${lang}`}
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
              placeholder="e.g., Korean, Japanese, Spanish"
              className="language-input add-language-input"
            />
            <TextButton
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleAddLanguage}
              disabled={!newLanguage.trim()}
            >
              + Add
            </TextButton>
          </div>
        </div>
      </div>

      <div className="language-info-box">
        <h4>Language Support</h4>
        <ul>
          <li>Main language affects AI model responses and system prompts</li>
          <li>Sub languages are used for translation features</li>
          <li>The default sub language (marked with radio) is used for quick-translate in agent</li>
          <li>You can add multiple sub languages for multilingual projects</li>
        </ul>
      </div>
    </div>
  );
};

export default LanguagePanel;
