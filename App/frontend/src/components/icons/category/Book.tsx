import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Book: React.FC<IconProps> = ({
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
		<path fillRule="evenodd" clipRule="evenodd" d="M20.6857 6.83545V17.1635C20.7305 19.236 19.0881 20.9533 17.0157 20.999C16.9855 20.999 8.6267 21 8.6267 21C6.58638 21.0078 4.91481 19.3819 4.86617 17.3426V6.83545C4.82044 4.76302 6.46379 3.04573 8.53621 3.00097C8.56638 3 17.0293 3 17.0293 3C19.0823 3.0827 20.7003 4.77956 20.6857 6.83545Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M3.31445 16.697H6.64007M3.31445 11.9984H6.64007M3.31445 7.30078H6.64007" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};
