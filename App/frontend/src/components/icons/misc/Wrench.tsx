import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Wrench: React.FC<IconProps> = ({
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
		<path fillRule="evenodd" clipRule="evenodd" d="M19.0017 14.6573C17.0105 16.6485 14.0964 17.1497 11.637 16.1667L7.67493 20.1298C6.64726 21.1565 4.95519 21.3041 3.87992 20.327C2.73568 19.2876 2.7114 17.5237 3.78375 16.4503L7.85172 12.3824C6.8629 9.91615 7.36411 7.00214 9.35535 5.0109C11.3534 3.01286 14.2742 2.51844 16.7336 3.51407L13.3349 6.91278C13.028 7.21972 12.8939 7.65974 12.9794 8.08615L13.3 9.69663C13.4029 10.2124 13.807 10.6155 14.3228 10.7175L15.9274 11.0351C16.3529 11.1187 16.7919 10.9846 17.0989 10.6787L20.4985 7.27897C21.501 9.7316 20.9997 12.6592 19.0017 14.6573Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};