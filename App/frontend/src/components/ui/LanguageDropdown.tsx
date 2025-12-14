import React, { useState, useRef, useEffect } from 'react';
import { Globe } from '../icons';
import './LanguageDropdown.css';

interface LanguageDropdownProps {
  languages: string[];
  value: string;
  onChange: (lang: string) => void;
  title?: string;
  // Translate All button props
  showTranslateAll?: boolean;
  translateCount?: number;
  onTranslateAllClick?: () => void;
}

const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  languages,
  value,
  onChange,
  title = 'Select language',
  showTranslateAll = false,
  translateCount = 0,
  onTranslateAllClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const handleSelect = (lang: string) => {
    onChange(lang);
    setIsOpen(false);
  };

  return (
    <div className="language-dropdown" ref={dropdownRef} title={title}>
      <button
        className={`language-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="language-dropdown-icon"><Globe size={14} /></span>
        <span className="language-dropdown-value">{value}</span>
        <span className={`language-dropdown-arrow ${isOpen ? 'open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <div className={`language-dropdown-panel ${isOpen ? 'open' : ''}`}>
        <div className="language-dropdown-menu" role="listbox">
          <div className="language-dropdown-menu-inner">
            {languages.map((lang, index) => (
              <button
                key={lang}
                className={`language-dropdown-option ${lang === value ? 'selected' : ''}`}
                onClick={() => handleSelect(lang)}
                role="option"
                aria-selected={lang === value}
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <span className="language-dropdown-option-text">{lang}</span>
                {lang === value && (
                  <span className="language-dropdown-check">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M11.5 4L5.5 10L2.5 7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {showTranslateAll && translateCount > 0 && (
          <button
            className="language-dropdown-translate-btn"
            onClick={(e) => {
              e.stopPropagation();
              onTranslateAllClick?.();
              setIsOpen(false);
            }}
            title={`Translate ${translateCount} objects`}
          >
            <span className="language-dropdown-translate-icon"><Globe size={14} /></span>
            <span className="language-dropdown-translate-text">
              Translate All ({translateCount})
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default LanguageDropdown;
