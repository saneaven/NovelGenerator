import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Lightbulb: React.FC<IconProps> = ({
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
		<path d="M5.1875 9.80723C5.1875 12.62 6.89307 15.029 9.32544 16.0545V18.3195C9.32544 19.7935 10.5319 21 12.0049 21C13.4789 21 14.6854 19.7935 14.6854 18.3195V16.0662C17.5206 14.8675 19.3653 11.7434 18.6618 8.35462C18.1199 5.76074 16.0222 3.67475 13.4293 3.14449C9.04912 2.25716 5.1875 5.57686 5.1875 9.80723Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M9.32617 16.0703H14.692" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M13.0716 15.9236L14.2167 8.78125H9.73633L10.8815 15.9236" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};