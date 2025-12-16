import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Check } from '../icons';
import './CustomSelect.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // Calculate position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuHeight = Math.min(options.length * 36 + 8, 280); // Approximate
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      const shouldFlipUp = spaceBelow < menuHeight && spaceAbove > menuHeight;

      setMenuPosition({
        top: shouldFlipUp
          ? rect.top + window.scrollY - menuHeight - 4
          : rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen, options.length]);

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
        <span className="custom-select-value">
          {selectedOption?.label || placeholder}
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
            position: 'absolute',
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
          }}
          role="listbox"
        >
          <div className="custom-select-menu-inner">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`custom-select-option ${option.value === value ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}`}
                onClick={() => !option.disabled && handleSelect(option.value)}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
              >
                <span className="custom-select-option-text">{option.label}</span>
                {option.value === value && (
                  <span className="custom-select-check">
                    <Check size="sm" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default CustomSelect;
