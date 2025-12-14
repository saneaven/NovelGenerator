import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Logout: React.FC<IconProps> = ({
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
		<path d="M14.5775 7.62065V6.73816C14.5775 4.81457 13.0178 3.25391 11.0933 3.25391H6.48328C4.55969 3.25488 3 4.81457 3 6.73816V17.2619C3 19.1865 4.55969 20.7462 6.48328 20.7462H11.103C13.0217 20.7462 14.5765 19.1914 14.5775 17.2726V16.3814" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M21.0001 11.9987H9.61523M21.0001 11.9987L18.2314 9.24219M21.0001 11.9987L18.2314 14.7561" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};
