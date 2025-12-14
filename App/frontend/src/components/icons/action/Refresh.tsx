import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Refresh: React.FC<IconProps> = ({
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
		<path d="M4 8.09497L5.60843 11.8991L9.3916 10.2996" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M5.83008 11.805C5.92702 7.9839 9.06148 4.91406 12.9149 4.91406C16.8249 4.91406 19.9998 8.08892 19.9998 11.9989C19.9998 15.917 16.8249 19.0838 12.9149 19.0838C10.4914 19.0838 8.35865 17.872 7.07417 16.022" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};
