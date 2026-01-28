import React, { forwardRef } from 'react';
import { Loading } from '../common/Loading';
import './IconButton.css';

export interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  isActive?: boolean;
  disabled?: boolean;
  showDot?: boolean;
  showSpinner?: boolean;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      onClick,
      type = 'button',
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
        type={type}
        className={buttonClasses}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel || title}
        aria-expanded={ariaExpanded}
        disabled={disabled}
      >
        <span className="icon-button__icon">
          {icon}
          {showSpinner && <Loading size="xs" className="icon-button__spinner" />}
          {showDot && !showSpinner && <span className="icon-button__dot" />}
        </span>
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default IconButton;
