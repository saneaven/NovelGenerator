import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const GripVertical: React.FC<IconProps> = ({
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
      <circle cx="9" cy="5" r="1.5" fill={color} />
      <circle cx="15" cy="5" r="1.5" fill={color} />
      <circle cx="9" cy="12" r="1.5" fill={color} />
      <circle cx="15" cy="12" r="1.5" fill={color} />
      <circle cx="9" cy="19" r="1.5" fill={color} />
      <circle cx="15" cy="19" r="1.5" fill={color} />
    </svg>
  );
};
