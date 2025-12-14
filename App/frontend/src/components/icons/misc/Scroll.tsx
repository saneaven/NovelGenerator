import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Scroll: React.FC<IconProps> = ({
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
		<path d="M12.0003 13.9454C10.9256 13.9454 10.0544 13.0741 10.0544 11.9994C10.0544 10.9247 10.9256 10.0535 12.0003 10.0535C13.0751 10.0535 13.9463 10.9247 13.9463 11.9994C13.9463 13.0741 13.0751 13.9454 12.0003 13.9454Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M8.59446 17.5945L11.9999 20.9999L15.4053 17.5945" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M15.4053 6.40565L11.9999 3.00024L8.59446 6.40565" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};
