import React from 'react';
import type { IconProps } from '../types';
import { resolveIconSize } from '../types';

export const Timeline: React.FC<IconProps> = ({
  size = 'md',
  className = '',
  color = 'currentColor',
  strokeWidth = 1.8,
}) => {
  const resolvedSize = resolveIconSize(size);

  return (
    <svg
      className={className}
      width={resolvedSize}
      height={resolvedSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M4 6H20" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M4 12H20" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M4 18H20" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx="8" cy="6" r="2.25" fill={color} />
      <circle cx="15" cy="12" r="2.25" fill={color} />
      <circle cx="11" cy="18" r="2.25" fill={color} />
    </svg>
  );
};
