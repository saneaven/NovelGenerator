import React from 'react';
import './Skeleton.css';

const toCssSize = (value?: string | number): string | undefined => {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
};

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

/** A single shimmer block. Defaults to full width; size via props. */
export const Skeleton: React.FC<SkeletonProps> = ({ width, height, radius, className = '', style }) => (
  <span
    className={['skeleton', className].filter(Boolean).join(' ')}
    aria-hidden="true"
    style={{
      width: toCssSize(width),
      height: toCssSize(height),
      borderRadius: toCssSize(radius),
      ...style,
    }}
  />
);

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** Stacked text lines; the last line is shortened for a natural look. */
export const SkeletonText: React.FC<SkeletonTextProps> = ({ lines = 3, className = '' }) => (
  <div className={['skeleton-text', className].filter(Boolean).join(' ')} aria-hidden="true">
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton
        key={index}
        height={14}
        width={lines > 1 && index === lines - 1 ? '60%' : '100%'}
      />
    ))}
  </div>
);

interface SkeletonListProps {
  rows?: number;
  rowHeight?: number;
  className?: string;
}

/** Stacked card-shaped rows; used for sidebars and tree lists. */
export const SkeletonList: React.FC<SkeletonListProps> = ({ rows = 5, rowHeight = 56, className = '' }) => (
  <div className={['skeleton-list', className].filter(Boolean).join(' ')} aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => (
      <Skeleton key={index} height={rowHeight} radius="var(--border-radius-md)" />
    ))}
  </div>
);

export default Skeleton;
