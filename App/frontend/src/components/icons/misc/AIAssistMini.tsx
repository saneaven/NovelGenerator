import React from 'react';
import type { IconProps } from '../types';

export const AIAssistMini: React.FC<IconProps> = ({
  size = 16,
  className = '',
  color = 'currentColor'
}) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        className={className}
        xmlns="http://www.w3.org/2000/svg"
    >
        <path fill-rule="evenodd" clip-rule="evenodd" d="M15.4368 9.22653C12.487 10.1828 10.1748 12.4951 9.21841 15.4462C8.26202 12.4951 5.94977 10.1828 2.99996 9.22653C5.94977 8.27011 8.26202 5.95787 9.21841 3.00806C10.1748 5.95787 12.487 8.27011 15.4368 9.22653Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M21 17.5624C19.3735 18.0897 18.0985 19.3647 17.5711 20.992C17.0438 19.3647 15.7687 18.0897 14.1422 17.5624C15.7687 17.035 17.0438 15.76 17.5711 14.1334C18.0985 15.76 19.3735 17.035 21 17.5624Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
);
