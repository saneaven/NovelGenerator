import React from 'react';

interface LanguagePanelProps {
  primaryLanguage: string;
  secondaryLanguage: string | null;
  onPrimaryChange: (language: string) => void;
  onSecondaryChange: (language: string | null) => void;
}

const LanguagePanel: React.FC<LanguagePanelProps> = ({
  primaryLanguage,
  secondaryLanguage,
  onPrimaryChange,
  onSecondaryChange,
}) => {
  return (
    <div className="language-panel">
      <div className="panel-description">
        <p>Set your preferred languages for the application interface and content generation.</p>
      </div>

      <div className="language-settings-card">
        <div className="form-field">
          <label>Primary Language</label>
          <input
            type="text"
            value={primaryLanguage}
            onChange={(e) => onPrimaryChange(e.target.value)}
            placeholder="English"
            className="language-input"
          />
          <p className="field-hint">Main language for the application and AI responses</p>
        </div>

        <div className="form-field">
          <label>Secondary Language (Optional)</label>
          <input
            type="text"
            value={secondaryLanguage || ''}
            onChange={(e) => onSecondaryChange(e.target.value || null)}
            placeholder="e.g., Korean, Japanese, Spanish"
            className="language-input"
          />
          <p className="field-hint">
            Additional language for bilingual features like translation
          </p>
        </div>
      </div>

      <div className="language-info-box">
        <h4>📝 Language Support</h4>
        <ul>
          <li>Primary language affects AI model responses and system prompts</li>
          <li>Secondary language is used for translation features</li>
          <li>Both settings can be changed at any time</li>
        </ul>
      </div>
    </div>
  );
};

export default LanguagePanel;
