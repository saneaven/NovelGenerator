import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Advenced: React.FC<IconProps> = ({
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
<path d="M13.5479 12H16.3532" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M10.4526 12H7.64734" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M17.5145 18.2858L14.4166 16.9998C13.8907 16.7814 13.5479 16.2679 13.5479 15.6984V8.30219C13.5479 7.7327 13.8907 7.2192 14.4166 7.00086L17.5145 5.71484" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M6.48595 18.2858L9.58385 16.9998C10.1098 16.7814 10.4526 16.2679 10.4526 15.6984V8.30219C10.4526 7.7327 10.1098 7.2192 9.58385 7.00086L6.48595 5.71484" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<circle cx="19.0078" cy="5.16066" r="1.49269" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></circle>
<circle cx="19.0078" cy="18.8404" r="1.49269" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></circle>
<circle cx="1.49269" cy="1.49269" r="1.49269" transform="matrix(-1 0 0 1 6.48584 3.66797)" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></circle>
<circle cx="1.49269" cy="1.49269" r="1.49269" transform="matrix(-1 0 0 1 6.48584 17.3477)" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></circle>
<circle cx="17.8467" cy="12.0005" r="1.49269" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></circle>
<circle cx="1.49269" cy="1.49269" r="1.49269" transform="matrix(-1 0 0 1 7.64697 10.5078)" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></circle>
  </svg>
  );
};
