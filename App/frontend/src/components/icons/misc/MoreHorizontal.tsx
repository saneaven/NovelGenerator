import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const MoreHorizontal: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor',
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
      <circle cx="12" cy="12" r="1.5" fill={color} />
      <circle cx="6" cy="12" r="1.5" fill={color} />
      <circle cx="18" cy="12" r="1.5" fill={color} />
    </svg>
  );
};
