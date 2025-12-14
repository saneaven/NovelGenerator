import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const People: React.FC<IconProps> = ({
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
		<path d="M5.54102 19.9996C5.54102 17.891 7.20466 15.2656 11.9998 15.2656C16.794 15.2656 18.4576 17.8719 18.4576 19.9815" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M16.1254 8.12567C16.1254 10.4043 14.2784 12.2513 11.9997 12.2513C9.722 12.2513 7.875 10.4043 7.875 8.12567C7.875 5.847 9.722 4 11.9997 4C14.2784 4 16.1254 5.847 16.1254 8.12567Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};