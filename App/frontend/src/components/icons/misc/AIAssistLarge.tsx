import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const AIAssistLarge: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor',
  strokeWidth = 1.5,
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
<path d="M3 19.1479H10.1176" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M3 14.3828H7.43225" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M3 4.85156H20.9992" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M3 9.61719H10.0111" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M14.5117 17.619L14.3664 17.2259C13.8186 15.7434 12.6515 14.5745 11.1712 14.026L10.7786 13.8805L11.1712 13.735C12.6515 13.1864 13.8186 12.0176 14.3664 10.5351L14.5117 10.1419L14.657 10.5351C15.2047 12.0176 16.3718 13.1864 17.8522 13.735L18.2448 13.8805L17.8522 14.026C16.3718 14.5745 15.2047 15.7434 14.657 17.2259L14.5117 17.619Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
<path d="M19.8224 19.147C19.6508 18.5823 19.2096 18.1404 18.6457 17.9685C19.2096 17.7967 19.6508 17.3547 19.8224 16.7901C19.994 17.3547 20.4353 17.7967 20.9991 17.9685C20.4353 18.1404 19.994 18.5823 19.8224 19.147Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
    </svg>
  );
};
