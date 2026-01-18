import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Plus: React.FC<IconProps> = ({
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
<path fillRule="evenodd" clipRule="evenodd" d="M16.2178 3H7.78313C4.84378 3 3 5.08119 3 8.02638V15.9736C3 18.9188 4.83503 21 7.78313 21H16.2169C19.1659 21 21 18.9188 21 15.9736V8.02638C21 5.08119 19.1659 3 16.2178 3Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M12 8.69434V15.2872" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M15.2989 11.9924H8.69922" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};