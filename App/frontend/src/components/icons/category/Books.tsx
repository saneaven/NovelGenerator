import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Books: React.FC<IconProps> = ({
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
		<path d="M7.04356 16.0254H19.4373L19.4431 19.8044C19.4422 20.4651 18.906 20.9992 18.2454 20.9992H7.04356C5.66972 20.9992 4.55664 19.8861 4.55664 18.5123C4.55664 17.1385 5.66972 16.0254 7.04356 16.0254Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M4.55664 18.5131V5.59103C4.55664 4.15978 5.71642 3 7.14767 3H18.2386C18.9002 3 19.4373 3.53708 19.4373 4.1987V16.0262" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M7.22266 18.5586H19.4374" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M8.35938 16.0265V3.09375" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M11.9805 7.13086H13.4535M11.9805 10.0222H15.309" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};
