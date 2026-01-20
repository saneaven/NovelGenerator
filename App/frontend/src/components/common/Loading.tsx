import React from 'react';
import './Loading.css';

type LoadingSize = 'xs' | 'sm' | 'md' | 'lg';
type LoadingVariant = 'spinner' | 'dots' | 'pulse';

interface LoadingProps {
  size?: LoadingSize;
  variant?: LoadingVariant;
  text?: string;
  fullPage?: boolean;
  className?: string;
}

export const Loading: React.FC<LoadingProps> = ({
  size = 'md',
  variant = 'spinner',
  text,
  fullPage = false,
  className = '',
}) => {
  const containerClass = [
    'loading',
    `loading--${size}`,
    `loading--${variant}`,
    fullPage ? 'loading--fullpage' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const renderIndicator = () => {
    switch (variant) {
      case 'dots':
        return (
          <span className="loading-dots" role="status" aria-label="Loading">
            <span className="loading-dot" />
            <span className="loading-dot" />
            <span className="loading-dot" />
          </span>
        );
      case 'pulse':
        return (
          <span className="loading-pulse" role="status" aria-label="Loading" />
        );
      case 'spinner':
      default:
        return (
          <span className="loading-spinner" role="status" aria-label="Loading" />
        );
    }
  };

  return (
    <div className={containerClass}>
      {renderIndicator()}
      {text && <span className="loading-text">{text}</span>}
    </div>
  );
};

export default Loading;
