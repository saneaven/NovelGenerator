import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Palette: React.FC<IconProps> = ({
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
		<path d="M3 17.5002C3 19.4335 4.56649 21 6.49978 21C8.43308 21 9.99957 19.4335 9.99957 17.5002V6.49978C9.99957 4.56649 8.43308 3 6.49978 3C4.56649 3 3 4.56649 3 6.49978V17.5002Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M8.97461 19.9763L17.6253 11.3266C18.9914 9.95956 18.9914 7.74313 17.6253 6.3761C16.2583 5.01005 14.0419 5.01005 12.6748 6.3761L10.0001 9.05178" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M6.5 20.9999L17.5001 20.9996C19.4334 20.9996 20.9999 19.4331 20.9999 17.4998C20.9999 15.5665 19.4334 14 17.5001 14H14.9499" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M6.50049 17.5425V17.5793M6.64963 17.5504C6.64963 17.6332 6.58242 17.7004 6.49957 17.7004C6.41673 17.7004 6.34961 17.6332 6.34961 17.5504C6.34961 17.4675 6.41673 17.4004 6.49957 17.4004C6.58242 17.4004 6.64963 17.4675 6.64963 17.5504Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};