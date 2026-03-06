import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from '../icons';
import './CustomSelect.css';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RenderOptionProps {
  option: SelectOption;
  isSelected: boolean;
  onSelect: () => void;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Label prefix shown in trigger (e.g., "Preset:") */
  triggerLabel?: string;
  /** Minimum width for dropdown menu */
  minWidth?: number;
  /** Custom render function for options */
  renderOption?: (props: RenderOptionProps) => React.ReactNode;
  /** Footer content rendered below options */
  footer?: React.ReactNode;
  /** Dropdown alignment relative to trigger */
  align?: 'left' | 'right';
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className = '',
  triggerLabel,
  minWidth,
  renderOption,
  footer,
  align = 'left',
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = minWidth ? Math.max(rect.width, minWidth) : rect.width;
    const measuredHeight = menuRef.current?.offsetHeight ?? Math.min(options.length * 40 + 8, 280);
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldFlipUp = spaceBelow < measuredHeight && spaceAbove > spaceBelow;

    const unclampedLeft = align === 'right'
      ? rect.right - menuWidth
      : rect.left;
    const left = Math.min(
      Math.max(8, unclampedLeft),
      Math.max(8, viewportWidth - menuWidth - 8),
    );
    const top = shouldFlipUp
      ? Math.max(8, rect.top - measuredHeight - 4)
      : Math.min(rect.bottom + 4, Math.max(8, viewportHeight - measuredHeight - 8));

    setMenuPosition({
      top,
      left,
      width: menuWidth,
    });
  }, [isOpen, options.length, minWidth, align]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Close on scroll
  useEffect(() => {
    if (isOpen) {
      const handleScroll = () => setIsOpen(false);
      window.addEventListener('scroll', handleScroll, true);
      return () => window.removeEventListener('scroll', handleScroll, true);
    }
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className={`custom-select ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className={`custom-select-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {triggerLabel && (
          <span className="custom-select-trigger-label">{triggerLabel}</span>
        )}
        <span className="custom-select-value">
          {selectedOption?.label || placeholder || t('customSelect.placeholder')}
        </span>
        <span className={`custom-select-arrow ${isOpen ? 'open' : ''}`}>
          <ChevronDown size="sm" />
        </span>
      </button>

      {isOpen && ReactDOM.createPortal(
        <div
          ref={menuRef}
          className="custom-select-menu"
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
          }}
          role="listbox"
        >
          <div className="custom-select-menu-inner">
            {options.map((option) => {
              const isSelected = option.value === value;

              if (renderOption) {
                return (
                  <div key={option.value} role="option" aria-selected={isSelected}>
                    {renderOption({
                      option,
                      isSelected,
                      onSelect: () => !option.disabled && handleSelect(option.value),
                    })}
                  </div>
                );
              }

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`custom-select-option ${isSelected ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}`}
                  onClick={() => !option.disabled && handleSelect(option.value)}
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                >
                  <div className="custom-select-option-content">
                    <span className="custom-select-option-text">{option.label}</span>
                    {option.description && (
                      <span className="custom-select-option-description">{option.description}</span>
                    )}
                  </div>
                  {isSelected && (
                    <span className="custom-select-check">
                      <Check size="sm" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {footer && (
            <div className="custom-select-footer">
              {footer}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default CustomSelect;
