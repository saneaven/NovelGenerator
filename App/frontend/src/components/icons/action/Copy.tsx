import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Copy: React.FC<IconProps> = ({
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
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 15H4C3.44772 15 3 14.5523 3 14V4C3 3.44772 3.44772 3 4 3H14C14.5523 3 15 3.44772 15 4V5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
