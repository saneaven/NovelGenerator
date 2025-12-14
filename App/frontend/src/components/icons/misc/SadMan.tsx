import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const SadMan: React.FC<IconProps> = ({
  size = 16,
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
		<path d="M12 21C16.9709 21 21 16.9699 21 12C21 7.02908 16.9709 3 12 3C7.02908 3 3 7.02908 3 12C3 16.9699 7.02908 21 12 21Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M14.8675 16.3294C14.8675 14.6267 13.5832 13.2461 11.9992 13.2461C10.4152 13.2461 9.13086 14.6267 9.13086 16.3294H14.8675Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M7.49609 8.50781L9.28344 9.61992L7.49609 10.7379" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M16.5032 8.50781L14.7158 9.61992L16.5032 10.7379" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
    </svg>
);
};