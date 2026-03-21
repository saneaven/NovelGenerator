import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Globe } from '../icons';
import { TextButton } from '../TextButton';
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
  title,
  showTranslateAll = false,
  translateCount = 0,
  onTranslateAllClick,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMeasured, setIsMeasured] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const [shouldOpenUpward, setShouldOpenUpward] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsMeasured(false);
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen && panelRef.current && !isMeasured) {
      setIsMeasured(true);
    }
  }, [isOpen, isMeasured]);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth || Math.max(rect.width, 160);
    const panelHeight = panelRef.current?.offsetHeight || 200;
    const isInMobileFooter = Boolean(triggerRef.current.closest('.mobile-footer'));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextShouldOpenUpward = isInMobileFooter || (spaceBelow < panelHeight && spaceAbove > panelHeight);
    const alignedTop = nextShouldOpenUpward
      ? rect.top + window.scrollY - panelHeight - 6
      : rect.bottom + window.scrollY + 6;
    const minTop = window.scrollY + 8;
    const maxTop = window.scrollY + viewportHeight - panelHeight - 8;
    const minLeft = window.scrollX + 8;
    const maxLeft = window.scrollX + viewportWidth - panelWidth - 8;
    const alignedLeft = rect.right + window.scrollX - panelWidth;

    setShouldOpenUpward(nextShouldOpenUpward);
    setPanelPosition({
      top: Math.min(Math.max(alignedTop, minTop), Math.max(minTop, maxTop)),
      left: Math.min(Math.max(alignedLeft, minLeft), Math.max(minLeft, maxLeft)),
    });
  }, [isOpen, isMeasured, showTranslateAll, translateCount, languages.length]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTrigger = dropdownRef.current?.contains(target);
      const clickedPanel = panelRef.current?.contains(target);

      if (!clickedTrigger && !clickedPanel) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Close on scroll (only when an ancestor of the trigger scrolls)
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleScroll = (e: Event) => {
      const scrollTarget = e.target;
      if (panelRef.current?.contains(scrollTarget as Node)) return;
      if (scrollTarget instanceof Node && triggerRef.current
        && (scrollTarget.contains(triggerRef.current) || scrollTarget === document)) {
        setIsOpen(false);
      }
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  const handleSelect = (lang: string) => {
    onChange(lang);
    setIsOpen(false);
  };

  const panel = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        className={`language-dropdown-panel language-dropdown-panel--portal ${isOpen ? 'open' : ''} ${shouldOpenUpward ? 'language-dropdown-panel--upward' : ''}`}
        style={{
          top: panelPosition.top,
          left: panelPosition.left,
          minWidth: triggerRef.current?.offsetWidth,
          opacity: isMeasured ? 1 : 0,
        }}
      >
        <div className="language-dropdown-section">
          <div className="language-dropdown-menu" role="listbox">
            <div className="language-dropdown-menu-inner">
              {languages.map((lang, index) => (
                <button
                  type="button"
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
                      <Check size="md" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {showTranslateAll && translateCount > 0 && (
          <div className="language-dropdown-section" onClick={(e) => e.stopPropagation()}>
            <TextButton
              variant="primary"
              size="sm"
              onClick={() => {
                onTranslateAllClick?.();
                setIsOpen(false);
              }}
              title={t('languageDropdown.objectTranslation', { count: translateCount })}
              iconLeft={<Globe size="sm" />}
              fullWidth
            >
              {t('languageDropdown.translate', { count: translateCount })}
            </TextButton>
          </div>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <div className="language-dropdown" ref={dropdownRef} title={title || t('languageDropdown.selectLanguage')}>
      <button
        type="button"
        ref={triggerRef}
        className={`language-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="language-dropdown-icon"><Globe size="lg" /></span>
        <span className="language-dropdown-value">{value}</span>
        <span className={`language-dropdown-arrow ${isOpen ? 'open' : ''}`}>
            <ChevronDown size="md" />
        </span>
      </button>
      {panel}
    </div>
  );
};

export default LanguageDropdown;
