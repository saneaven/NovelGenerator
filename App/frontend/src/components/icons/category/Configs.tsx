import React from 'react';
import { resolveIconSize, type IconProps } from '../types';

export const Configs: React.FC<IconProps> = ({
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
    <rect x="3" y="3.00002" width="18" height="18" rx="5" stroke={ color } strokeWidth={ strokeWidth } strokeLinecap="round" strokeLinejoin="round"></rect>
    <path d="M13.7816 21.0001L13.7812 16.1546C15.3988 15.4608 16.5326 13.8559 16.5326 11.9845C16.5326 10.1067 15.3924 8.49551 13.7689 7.81404L13.7689 11.0091C13.7684 11.2971 13.6251 11.5664 13.3859 11.7271L12.4826 12.3319C12.1923 12.5263 11.813 12.5268 11.5223 12.3328L10.6149 11.7266C10.3743 11.5664 10.2305 11.2967 10.2305 11.0082V7.81404C8.60698 8.5019 7.4668 10.1067 7.4668 11.9845C7.4668 13.8559 8.60059 15.4608 10.2241 16.155L10.2241 21.0001" stroke={ color } strokeWidth={ strokeWidth } strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
  );
};