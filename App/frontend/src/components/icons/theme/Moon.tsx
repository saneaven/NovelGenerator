import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Moon: React.FC<IconProps> = ({
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
		<path d="M9.18243 14.4155C8.23762 12.329 8.27904 9.83327 9.50996 7.70126C11.1887 4.79366 14.5476 3.4663 17.6538 4.24457C17.6941 4.25432 17.7013 4.30887 17.6661 4.33085C15.2653 5.83164 14.0159 8.7891 14.7868 11.6685C15.5588 14.5475 18.1196 16.484 20.9531 16.5766C20.9945 16.578 21.0156 16.6289 20.9852 16.6581C18.8971 18.678 15.754 19.3041 13.0226 18.1515" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M7.07943 16.4954C6.12256 16.5039 5.34961 17.1468 5.34961 18.2406C5.34961 18.9491 5.77127 19.5584 6.37684 19.8319C6.63165 19.9353 6.88539 19.9747 7.07783 19.9747H11.207C11.4 19.9747 11.6543 19.9374 11.9123 19.834C12.5184 19.56 12.9379 18.9491 12.9379 18.2406C12.9379 17.1468 12.1655 16.5039 11.2086 16.4954C11.2086 15.8072 10.6686 14.4302 9.14402 14.4302C7.61943 14.4302 7.07943 15.8072 7.07943 16.4954Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M8.00879 4.91162V4.91926" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
		<path d="M4.7205 8.28049C4.97142 9.10492 5.6166 9.75013 6.44099 10.0011C5.6166 10.252 4.97142 10.8972 4.7205 11.7216C4.46958 10.8972 3.8244 10.252 3 10.0011C3.8244 9.75013 4.46958 9.10492 4.7205 8.28049Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};