import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Toggle: React.FC<IconProps> = ({
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
      <rect x="2" y="7" width="20" height="10" rx="5" stroke={color} strokeWidth={strokeWidth} />
      <circle cx="16" cy="12" r="3" fill={color} />
    </svg>
  );
};
