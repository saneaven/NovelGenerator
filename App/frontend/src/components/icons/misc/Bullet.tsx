import React from 'react';
import type { IconProps } from '../types';

export const Bullet: React.FC<IconProps> = ({
  size = 16,
  className = '',
  color = 'currentColor'
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Placeholder: filled square */}
    <circle cx="8" cy="8" r="4" />
  </svg>
);
