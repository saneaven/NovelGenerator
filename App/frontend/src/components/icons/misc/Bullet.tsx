import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Bullet: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor'
}) => {
  const resolvedSize = resolveIconSize(size);
  return (
  <svg
    width={resolvedSize}
    height={resolvedSize}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Placeholder: filled square */}
    <circle cx="8" cy="8" r="4" fill={color} />
  </svg>
  );
};
