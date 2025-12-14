import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Workspace: React.FC<IconProps> = ({
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
		<path d="M5.6445 14.0059L4.16582 15.4797C3.75793 15.8712 3.52328 16.4094 3.51401 16.9746L3.46738 19.8174C3.46102 20.2054 3.76869 20.526 4.15663 20.5355L6.99889 20.6056C7.56408 20.6195 8.11143 20.4072 8.51932 20.0157L9.998 18.5418" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M13.9204 5.75716L15.9955 3.68882C17.3378 2.40051 18.7074 3.45235 19.702 4.48864C20.6966 5.52493 21.6913 6.93648 20.349 8.22479L18.3227 10.2445" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M9.63721 14.3628L11.5422 12.4578" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M13.3101 18.0347L15.2151 16.1296" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M5.96533 10.6907L7.87035 8.78564" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M20.4516 18.2366L18.2372 20.451C17.4632 21.225 16.4351 21.1603 15.6619 20.3871L3.61308 8.33833C2.83988 7.56513 2.77525 6.537 3.54948 5.76277L5.7636 3.54865C6.53757 2.77468 7.56545 2.83956 8.33865 3.61277L20.3874 15.6616C21.1606 16.4348 21.2232 17.4649 20.4516 18.2366Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};