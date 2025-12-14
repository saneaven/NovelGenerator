import React from 'react';
import type { IconProps } from '../types';

export const Sparkle: React.FC<IconProps> = ({
  size = 16,
  className = '',
  color = 'currentColor'
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 124"
    fill={color}
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Placeholder: filled square */}
    <rect x="0" y="0" width="16" height="16" />
  </svg>
);
