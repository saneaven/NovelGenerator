import React, { forwardRef } from 'react';
import './TextButton.css';

export interface TextButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  title?: string;
  form?: string;
}

const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(
  (
    {
      children,
      onClick,
      type = 'button',
      variant = 'secondary',
      size = 'md',
      iconLeft,
      iconRight,
      disabled = false,
      loading = false,
      fullWidth = false,
      className = '',
      title,
      form,
    },
    ref
  ) => {
    const buttonClasses = [
      'text-button',
      `text-button--${variant}`,
      `text-button--${size}`,
      fullWidth && 'text-button--full-width',
      loading && 'text-button--loading',
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
        disabled={disabled || loading}
        title={title}
        form={form}
      >
        {loading && (
          <span className="text-button__spinner">
            <span className="text-button__spinner-ring" />
          </span>
        )}
        {iconLeft && !loading && (
          <span className="text-button__icon text-button__icon--left">
            {iconLeft}
          </span>
        )}
        <span className="text-button__label">{children}</span>
        {iconRight && (
          <span className="text-button__icon text-button__icon--right">
            {iconRight}
          </span>
        )}
      </button>
    );
  }
);

TextButton.displayName = 'TextButton';

export default TextButton;
