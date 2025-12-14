import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Shuffle: React.FC<IconProps> = ({
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
		<path d="M17.4473 14.9586C17.4473 14.9586 18.9837 16.495 19.9684 17.4798C18.9837 18.4636 17.4473 20 17.4473 20" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M17.4473 4C17.4473 4 18.9837 5.53642 19.9684 6.52114C18.9837 7.50498 17.4473 9.0414 17.4473 9.0414" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M4.03125 6.52344C5.96173 6.52344 7.6974 6.52344 9.21168 8.02001" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M13.9668 15.8867C15.791 17.4807 17.9872 17.4807 19.9708 17.4807" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M19.9685 6.51953C16.9798 6.51953 13.494 6.51925 11.5006 11.9981C9.50815 17.4778 7.01801 17.4778 4.0293 17.4778" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};