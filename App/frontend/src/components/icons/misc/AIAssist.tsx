import React from 'react';
import type { IconProps } from '../types';

export const AIAssist: React.FC<IconProps> = ({
  size = 16,
  className = '',
  color = 'currentColor',
  strokeWidth = 1.5,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    
  >
<path fill-rule="evenodd" clip-rule="evenodd" d="M3 15.9254C5.27269 16.6622 7.05414 18.4437 7.79098 20.7174C8.52784 18.4437 10.3093 16.6622 12.582 15.9254C10.3093 15.1886 8.52784 13.4071 7.79098 11.1344C7.05414 13.4071 5.27269 15.1886 3 15.9254Z" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round"></path>
<path fill-rule="evenodd" clip-rule="evenodd" d="M14.6488 10.9655C16.1552 11.4539 17.336 12.6347 17.8244 14.1418C18.3128 12.6347 19.4936 11.4539 21 10.9655C19.4936 10.4771 18.3128 9.29632 17.8244 7.78992C17.336 9.29632 16.1552 10.4771 14.6488 10.9655Z" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round"></path>
<path fill-rule="evenodd" clip-rule="evenodd" d="M9.12097 5.2487C10.0536 5.55105 10.7847 6.28212 11.0871 7.21517C11.3894 6.28212 12.1205 5.55105 13.0532 5.2487C12.1205 4.94631 11.3894 4.21524 11.0871 3.28259C10.7847 4.21524 10.0536 4.94631 9.12097 5.2487Z" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
);
