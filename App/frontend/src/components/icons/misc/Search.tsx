import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Search: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor',
  strokeWidth = 1.5
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
      <circle cx="11" cy="11" r="7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 20L16.65 16.65" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
