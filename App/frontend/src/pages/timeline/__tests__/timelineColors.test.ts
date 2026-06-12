import { describe, expect, it } from 'vitest';
import { oklchToHex, trackColorProps } from '../timelineColors';

describe('trackColorProps', () => {
  it('carries the color via --tl-base on .tl-colored', () => {
    const props = trackColorProps('oklch(0.680 0.140 250.0)');
    expect(props.className).toBe('tl-colored');
    expect(props.style).toEqual({ '--tl-base': 'oklch(0.680 0.140 250.0)' });
  });

  it('falls back to the brand default class for null (mixed anchors)', () => {
    expect(trackColorProps(null)).toEqual({ className: 'tl-color--default' });
    expect(trackColorProps(undefined)).toEqual({ className: 'tl-color--default' });
  });
});

describe('oklchToHex', () => {
  it('converts known colors within rounding distance', () => {
    // oklch(0.628 0.258 29.23) ≈ pure red
    const red = oklchToHex('oklch(0.628 0.258 29.23)');
    expect(red).toMatch(/^#[0-9a-f]{6}$/);
    const r = parseInt(red.slice(1, 3), 16);
    const g = parseInt(red.slice(3, 5), 16);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(20);

    expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000');
  });

  it('returns a neutral fallback for unparseable input', () => {
    expect(oklchToHex('nope')).toBe('#888888');
  });
});
