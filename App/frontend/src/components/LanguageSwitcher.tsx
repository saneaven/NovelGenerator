/**
 * LanguageSwitcher Component
 *
 * Simple dropdown to switch between available languages for an object.
 * Switches language WITHOUT creating a new version.
 */

import React from 'react';
import type { UnifiedObject } from '../types/unifiedObject';
import './LanguageSwitcher.css';

interface LanguageSwitcherProps {
  object: UnifiedObject | null | undefined;
  onLanguageChange: (language: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  object,
  onLanguageChange,
  disabled = false,
  showLabel = true,
}) => {
  if (!object || !object.languages) {
    return null;
  }

  const { languages } = object;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value;
    if (newLanguage !== languages.active) {
      onLanguageChange(newLanguage);
    }
  };

  if (languages.available.length <= 1) {
    // Only one language available, no need to show switcher
    return showLabel ? (
      <div className="language-switcher-single">
        <span className="language-label">Language:</span>
        <span className="language-value">{languages.active}</span>
      </div>
    ) : null;
  }

  return (
    <div className="language-switcher">
      {showLabel && <label htmlFor="language-select" className="language-label">Language:</label>}
      <select
        id="language-select"
        className="language-select"
        value={languages.active}
        onChange={handleChange}
        disabled={disabled}
      >
        {languages.available.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
            {lang === languages.default && ' (Default)'}
          </option>
        ))}
      </select>
      <span className="language-count">
        {languages.available.length} language{languages.available.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
};

export default LanguageSwitcher;
