import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Lightning: React.FC<IconProps> = ({
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
    <path d="M18.584 9.78627C19.3965 9.78627 19.8664 10.7086 19.3887 11.3664L12.694 20.5865C12.1278 21.3678 10.8931 20.966 10.8931 20.0028V14.2127H5.41627C4.60385 14.2127 4.13391 13.2913 4.61163 12.6336L11.3063 3.4124C11.8725 2.63209 13.1063 3.03295 13.1063 3.99715V9.78627H18.584Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};