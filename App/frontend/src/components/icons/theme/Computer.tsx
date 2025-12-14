import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Computer: React.FC<IconProps> = ({
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
		<path d="M7.02811 3.28516H16.9709C19.1961 3.28516 21 5.08905 21 7.31424V12.7707C21 14.9959 19.1961 16.7998 16.9709 16.7998H7.02811C4.80389 16.7998 3 14.9959 3 12.7707V7.31424C3 5.08905 4.80389 3.28516 7.02811 3.28516Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M7.05469 20.7148H16.943" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M9.88339 16.7969L9.24609 20.7141" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M14.1152 16.7969L14.7525 20.7141" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M12.6621 12.6133H15.7095" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M8.28906 7.70703L10.4773 9.89525L8.28906 12.0835" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};