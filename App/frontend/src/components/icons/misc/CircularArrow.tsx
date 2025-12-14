import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const CircularArrow: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor',
  strokeWidth = 1.5,
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
        <path d="M10.5977 15.375L13.9894 11.9978L10.5977 8.62062" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 21C16.9699 21 21 16.9709 21 12C21 7.02908 16.9699 3 12 3C7.03005 3 3 7.02908 3 12C3 16.9709 7.03005 21 12 21Z" stroke={color}strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
    </svg>
  );
};
