/** Track color presets and derivation utilities. */

export interface TrackColorSet {
  barBg: string;
  barBorder: string;
  labelBar: string;
  rowTint: string;
}

const PRESETS: Record<string, number> = {
  red: 25,
  orange: 55,
  amber: 85,
  green: 145,
  teal: 175,
  cyan: 200,
  blue: 240,
  purple: 285,
  pink: 340,
  neutral: 0,
};

export const PRESET_NAMES = Object.keys(PRESETS);

function deriveFromHue(hue: number, isNeutral: boolean): TrackColorSet {
  const c = isNeutral ? 0.01 : undefined;
  return {
    barBg: `oklch(0.85 ${c ?? 0.06} ${hue})`,
    barBorder: `oklch(0.65 ${c ?? 0.12} ${hue})`,
    labelBar: `oklch(0.55 ${c ?? 0.15} ${hue})`,
    rowTint: `oklch(0.95 ${c ?? 0.02} ${hue} / 0.5)`,
  };
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

  const hue = PRESETS[color];
  if (hue !== undefined) {
    const result = deriveFromHue(hue, color === 'neutral');
    cache.set(color, result);
    return result;
  }

  // Fallback for unknown color strings
  return DEFAULT_COLORS;
}

/** CSS-safe preset swatch color for the color picker. */
export function presetSwatch(name: string): string {
  const hue = PRESETS[name];
  if (hue === undefined) return 'var(--color-border-strong)';
  if (name === 'neutral') return 'oklch(0.6 0.01 0)';
  return `oklch(0.6 0.15 ${hue})`;
}
