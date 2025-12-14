import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Chat: React.FC<IconProps> = ({
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
		<path d="M21 6.76564C21 5.11437 19.6569 3.77576 18 3.77576H6C4.34315 3.77576 3 5.11437 3 6.76564V19.2258C3 20.0283 3.9031 20.5017 4.56659 20.047L7.5582 17.9969C7.80826 17.8255 8.10461 17.7337 8.40809 17.7337H18C19.6569 17.7337 21 16.3951 21 14.7439V6.76564Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M10.0541 12.5637L9.95312 12.2904C9.57226 11.2596 8.76074 10.4468 7.73141 10.0654L7.45848 9.96425L7.73141 9.8631C8.76074 9.48167 9.57226 8.66895 9.95312 7.63815L10.0541 7.36475L10.1552 7.63815C10.536 8.66895 11.3475 9.48167 12.3769 9.8631L12.6499 9.96425L12.3769 10.0654C11.3475 10.4468 10.536 11.2596 10.1552 12.2904L10.0541 12.5637Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M15.3648 13.8058C15.1932 13.2411 14.752 12.7992 14.1882 12.6273C14.752 12.4554 15.1932 12.0135 15.3648 11.4489C15.5365 12.0135 15.9777 12.4554 16.5415 12.6273C15.9777 12.7992 15.5365 13.2411 15.3648 13.8058Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};