import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const BulletList: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor',
  strokeWidth = 2
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
      <line
        x1="9"
        y1="6"
        x2="20"
        y2="6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="9"
        y1="12"
        x2="20"
        y2="12"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="9"
        y1="18"
        x2="20"
        y2="18"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4.5" cy="6" r="1.5" fill={color} />
      <circle cx="4.5" cy="12" r="1.5" fill={color} />
      <circle cx="4.5" cy="18" r="1.5" fill={color} />
    </svg>
  );
};
