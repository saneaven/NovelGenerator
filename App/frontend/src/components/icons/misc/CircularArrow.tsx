import React from 'react';
import type { IconProps } from '../types';

export const CircularArrow: React.FC<IconProps> = ({
  size = 16,
  className = '',
  color = 'currentColor',
  strokeWidth = 1.5,
}) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        className={className}
        xmlns="http://www.w3.org/2000/svg"
    >
        <path d="M10.5977 15.375L13.9894 11.9978L10.5977 8.62062" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round"></path>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M12 21C16.9699 21 21 16.9709 21 12C21 7.02908 16.9699 3 12 3C7.03005 3 3 7.02908 3 12C3 16.9709 7.03005 21 12 21Z" stroke={color}stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
);
