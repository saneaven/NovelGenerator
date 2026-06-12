/** Timeline track color utilities.
 *
 * Track colors are canonical oklch strings, assigned server-side at creation
 * when not chosen manually (roots spread hues apart; children derive from
 * their parent, darker with depth). The UI derives accent/tint/text via CSS
 * relative color syntax from a single `--tl-base` custom property.
 */

import type { CSSProperties } from 'react';

export interface TrackColorSet {
  barBg: string;
  barBorder: string;
  labelBar: string;
  rowTint: string;
}

export interface TrackColorProps {
  className: string;
  style?: CSSProperties;
}

/** Quick-pick swatches for the track color picker; stored verbatim. */
export const SWATCH_COLORS: readonly string[] = [
  'oklch(0.550 0.150 25.0)',
  'oklch(0.580 0.140 55.0)',
  'oklch(0.620 0.130 85.0)',
  'oklch(0.560 0.130 145.0)',
  'oklch(0.560 0.120 175.0)',
  'oklch(0.580 0.120 200.0)',
  'oklch(0.560 0.140 240.0)',
  'oklch(0.560 0.150 285.0)',
  'oklch(0.580 0.150 340.0)',
  'oklch(0.550 0.010 0.0)',
];

/**
 * className + style pair carrying the track color custom properties
 * (--tl-accent / --tl-tint / --tl-text are derived from --tl-base in
 * TimelineStream.css, with dark-theme variants). A null color — e.g. an
 * anchor grouping events of differently-colored tracks — falls back to the
 * brand default.
 */
export function trackColorProps(color: string | null | undefined): TrackColorProps {
  if (!color) return { className: 'tl-color--default' };
  return { className: 'tl-colored', style: { '--tl-base': color } as CSSProperties };
}

const DEFAULT_COLORS: TrackColorSet = {
  barBg: 'var(--color-brand-primary-tint)',
  barBorder: 'var(--color-brand-primary-outline)',
  labelBar: 'var(--color-brand-primary)',
  rowTint: 'var(--color-brand-primary-soft)',
};

const cache = new Map<string, TrackColorSet>();

export function getTrackColors(color: string | null | undefined): TrackColorSet {
  if (!color) return DEFAULT_COLORS;

  const cached = cache.get(color);
  if (cached) return cached;

  const result: TrackColorSet = {
    barBg: `oklch(from ${color} 0.85 calc(c * 0.45) h)`,
    barBorder: `oklch(from ${color} 0.65 calc(c * 0.85) h)`,
    labelBar: `oklch(from ${color} calc(min(l, 0.55)) c h)`,
    rowTint: `oklch(from ${color} 0.95 calc(c * 0.15) h / 0.5)`,
  };
  cache.set(color, result);
  return result;
}

/** oklch(L C H) → #rrggbb, for seeding `<input type="color">`. */
export function oklchToHex(color: string): string {
  const match = /^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?\s*(?:\/\s*[0-9.]+%?\s*)?\)$/i.exec(color.trim());
  if (!match) return '#888888';
  const l = match[1].endsWith('%') ? parseFloat(match[1]) / 100 : parseFloat(match[1]);
  const c = parseFloat(match[2]);
  const h = parseFloat(match[3]);

  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [ll, mm, ss] = [l_, m_, s_].map((v) => v * v * v);

  const linear = [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
  ];
  const hex = linear.map((v) => {
    const clamped = Math.min(Math.max(v, 0), 1);
    const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}
