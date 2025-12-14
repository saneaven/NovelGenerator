import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Loading: React.FC<IconProps> = ({
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
<path d="M10.9772 4L10.9699 4.0064M7.12942 5.5592L7.1221 5.56651M4.5904 8.83341L4.58309 8.83981M4.01903 12.9307L4.01172 12.938M5.57779 16.779L5.57048 16.7854" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M19.8608 4.30078L15.1875 4.36477L15.2506 9.01251" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M15.1873 4.64062C19.1548 6.36844 21.0381 10.9668 19.3925 14.9984C17.7287 19.1031 13.0481 21.0777 8.94336 19.4048" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};