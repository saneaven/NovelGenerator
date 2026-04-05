import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Pause: React.FC<IconProps> = ({
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
      <rect x="6" y="5" width="4" height="14" rx="1" stroke={color} strokeWidth={strokeWidth} fill={color}/>
      <rect x="14" y="5" width="4" height="14" rx="1" stroke={color} strokeWidth={strokeWidth} fill={color}/>
    </svg>
  );
};
