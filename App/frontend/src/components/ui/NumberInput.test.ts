import { describe, it, expect } from 'vitest';
import { resolveNumberInput, type NumberInputParseOpts } from './numberInputParse';

const opts = (over: Partial<NumberInputParseOpts> = {}): NumberInputParseOpts => ({
  integer: true,
  allowEmpty: false,
  fallback: 1,
  ...over,
});

describe('resolveNumberInput — live (change) commits', () => {
  it('commits a valid number as the user types', () => {
    expect(resolveNumberInput('42', opts(), false)).toEqual({ commit: true, value: 42, display: undefined });
  });

  it('regression: typing a value commits a non-zero result before blur', () => {
    // Jump-to-date bug: the typed value must reach onValueChange on change,
    // not only on blur, so the jump base is computed from the entered date.
    const result = resolveNumberInput('1500', opts({ min: 1 }), false);
    expect(result.commit).toBe(true);
    expect(result.value).toBe(1500);
  });

  it('clamps to min and max on change', () => {
    expect(resolveNumberInput('0', opts({ min: 1, max: 12 }), false).value).toBe(1);
    expect(resolveNumberInput('99', opts({ min: 1, max: 12 }), false).value).toBe(12);
  });

  it('truncates integers but keeps floats when integer=false', () => {
    expect(resolveNumberInput('3.9', opts(), false).value).toBe(3);
    expect(resolveNumberInput('3.9', opts({ integer: false }), false).value).toBe(3.9);
  });

  it('does NOT commit partial / NaN input on change (so the user can keep typing)', () => {
    expect(resolveNumberInput('-', opts(), false)).toEqual({ commit: false, value: undefined });
    expect(resolveNumberInput('1.', opts({ integer: false }), false)).toMatchObject({ commit: true, value: 1 });
    expect(resolveNumberInput('abc', opts(), false)).toEqual({ commit: false, value: undefined });
  });

  it('empty on change: commits undefined only when allowEmpty, otherwise waits for blur', () => {
    expect(resolveNumberInput('', opts({ allowEmpty: true }), false)).toMatchObject({ commit: true, value: undefined });
    expect(resolveNumberInput('   ', opts({ allowEmpty: false }), false)).toEqual({ commit: false, value: undefined });
  });
});

describe('resolveNumberInput — blur (final) normalization', () => {
  it('commits and reports normalized display for a valid number', () => {
    expect(resolveNumberInput('07', opts({ min: 1, max: 12 }), true)).toEqual({ commit: true, value: 7, display: '7' });
  });

  it('empty falls back to the fallback value when not allowEmpty', () => {
    expect(resolveNumberInput('', opts({ min: 5, fallback: 5 }), true)).toEqual({ commit: true, value: 5, display: '5' });
  });

  it('empty commits undefined and clears the field when allowEmpty', () => {
    expect(resolveNumberInput('', opts({ allowEmpty: true }), true)).toEqual({ commit: true, value: undefined, display: '' });
  });

  it('NaN falls back to the fallback value', () => {
    expect(resolveNumberInput('xyz', opts({ fallback: 3 }), true)).toEqual({ commit: true, value: 3, display: '3' });
  });

  it('clamps to min/max on blur', () => {
    expect(resolveNumberInput('1000', opts({ min: 1, max: 200 }), true)).toEqual({ commit: true, value: 200, display: '200' });
  });
});
