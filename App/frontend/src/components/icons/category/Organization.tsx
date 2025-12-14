import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Organization: React.FC<IconProps> = ({
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
		<path d="M20.121 8.71702V15.2822C20.121 16.152 19.6568 16.9561 18.9036 17.391L13.2179 20.6731C12.4647 21.109 11.5362 21.109 10.783 20.6731L5.09733 17.391C4.34414 16.9561 3.87988 16.152 3.87988 15.2822V8.71702C3.87988 7.84727 4.34414 7.04315 5.09733 6.60828L10.783 3.32616C11.5362 2.89128 12.4647 2.89128 13.2179 3.32616L18.9036 6.60828C19.6568 7.04315 20.121 7.84727 20.121 8.71702Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M19.8055 7.56738L4.19531 16.5272" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M4.19447 7.56738L19.8047 16.5272" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M12 20.9462V3.0332" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};