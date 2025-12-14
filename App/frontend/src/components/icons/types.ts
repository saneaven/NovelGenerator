// Size presets mapped to rem values
export const ICON_SIZES = {
  xs: '0.75rem',   // 12px
  sm: '1.0rem',  // 14px
  md: '1.125rem',      // 16px
  lg: '1.25rem',  // 18px
  xl: '1.5rem',   // 20px
  '2xl': '2rem', // 24px
  '3xl': '3rem',   // 32px
  '4xl': '4rem',   // 48px
} as const;

export type IconSizePreset = keyof typeof ICON_SIZES;
export type IconSize = IconSizePreset | number | string;

export interface IconProps {
  size?: IconSize;
  className?: string;
  color?: string;
  strokeWidth?: number;
}

// Helper to resolve size value
export function resolveIconSize(size?: IconSize): string {
  if (!size) return '1em';
  if (typeof size === 'number') return `${size}px`;
  if (size in ICON_SIZES) return ICON_SIZES[size as IconSizePreset];
  return size;
}
