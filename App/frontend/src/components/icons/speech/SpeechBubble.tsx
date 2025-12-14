import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const SpeechBubble: React.FC<IconProps> = ({
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
		<path d="M8.00195 13.4216V9.96658M11.9993 13.4217V8.08691M15.9976 13.4217V11.2199" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M21 6.76527C21 5.11401 19.6569 3.77539 18 3.77539H6C4.34315 3.77539 3 5.11401 3 6.76527V19.2254C3 20.0279 3.9031 20.5013 4.56659 20.0466L7.5582 17.9965C7.80826 17.8251 8.10461 17.7334 8.40809 17.7334H18C19.6569 17.7334 21 16.3948 21 14.7435V6.76527Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};