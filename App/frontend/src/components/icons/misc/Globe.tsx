import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Globe: React.FC<IconProps> = ({
  size,
  className = '',
  color = 'currentColor',
  strokeWidth = 1.5
}) => {
  const resolvedSize = resolveIconSize(size);
  return (
<svg id="Earth language ai " className={className} width={resolvedSize} height={resolvedSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 10.9026 3.19641 9.85105 3.55601 8.87863" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"></path>
    <path d="M3 11.8958L6.2217 12.5104C6.2217 12.5104 8.00133 14.3371 8.69054 14.6134V17.0823L7.43528 19.5327" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
    <path d="M20.9176 11.3862C18.4749 12.1819 19.1439 10.1595 17.6023 9.54135C17.233 9.38238 14.4233 8.51622 14.3069 8.85471C13.5658 10.8868 12.9983 9.85538 14.7736 11.6181C16.8021 13.4907 14.4642 14.2223 14.3069 15.8951C14.1594 17.4643 12.8681 18.8681 14.0903 20.6831" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
    <path d="M9.21415 4.45776L9.30378 4.7003C9.64168 5.61484 10.3617 6.3359 11.2749 6.67431L11.5171 6.76406L11.2749 6.85381C10.3617 7.19222 9.64168 7.91328 9.30378 8.82782L9.21415 9.07038L9.12453 8.82782C8.78662 7.91328 8.06663 7.19222 7.15339 6.85381L6.91118 6.76406L7.15339 6.67431C8.06663 6.3359 8.78662 5.61484 9.12453 4.7003L9.21415 4.45776Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
    <path d="M4.17667 2.65161C4.34828 3.21628 4.78953 3.65819 5.35333 3.83006C4.78953 4.00193 4.34828 4.44384 4.17667 5.00851C4.00506 4.44384 3.56381 4.00193 3 3.83006C3.56381 3.65819 4.00506 3.21628 4.17667 2.65161Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
</svg>
  );
};
