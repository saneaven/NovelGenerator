import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Warning: React.FC<IconProps> = ({
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
		    <g id="Iconly/Light/Danger-Triangle" stroke="none" strokeWidth={strokeWidth} fill="none" fillRule="evenodd" strokeLinecap="round" strokeLinejoin="round">
		        <g id="Danger-Triangle" transform="translate(2.000000, 3.000000)" stroke={color}>
		            <path d="M2.814,17.4368 L17.197,17.4368 C18.779,17.4368 19.772,15.7268 18.986,14.3528 L11.8,1.7878 C11.009,0.4048 9.015,0.4038 8.223,1.7868 L1.025,14.3518 C0.239,15.7258 1.231,17.4368 2.814,17.4368 Z" id="Stroke-1" strokeWidth={strokeWidth}></path>
		            <line x1="10.0025" y1="10.4148" x2="10.0025" y2="7.3148" id="Stroke-3" strokeWidth={strokeWidth}></line>
		            <line x1="9.995" y1="13.5" x2="10.005" y2="13.5" id="Stroke-2" strokeWidth={strokeWidth}></line>
		        </g>
		    </g>
  </svg>
  );
};