import React, { forwardRef } from 'react';
import './IconButton.css';

export interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  isActive?: boolean;
  disabled?: boolean;
  showDot?: boolean;
  showSpinner?: boolean;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      onClick,
      title,
      ariaLabel,
      ariaExpanded,
      isActive = false,
      disabled = false,
      showDot = false,
      showSpinner = false,
      className = '',
      size = 'md',
      variant = 'secondary',
    },
    ref
  ) => {
    const buttonClasses = [
      'icon-button',
      `icon-button--${size}`,
      `icon-button--${variant}`,
      isActive && 'icon-button--active',
      disabled && 'icon-button--disabled',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        className={buttonClasses}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel || title}
        aria-expanded={ariaExpanded}
        disabled={disabled}
      >
        <span className="icon-button__icon">
          {icon}
          {showSpinner && (
            <span className="icon-button__spinner">
              <span className="icon-button__spinner-ring" />
            </span>
          )}
          {showDot && !showSpinner && <span className="icon-button__dot" />}
        </span>
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default IconButton;
