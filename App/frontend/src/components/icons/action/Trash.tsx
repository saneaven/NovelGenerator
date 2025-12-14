import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Trash: React.FC<IconProps> = ({
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
		<path d="M20.2649 6.40234H3.73535" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M18.9166 9.54688L18.3047 17.9235C18.1782 19.6562 16.7354 20.9988 14.9968 20.9988H9.00378C7.26619 20.9988 5.82241 19.6562 5.69594 17.9225L5.08398 9.54688" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M15.7733 6.40125L15.2704 3.92523C15.1244 3.37944 14.6292 3.00001 14.0649 3.00001H9.94375C9.37655 2.99806 8.8794 3.37749 8.7325 3.92523L8.23438 6.40125" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};
