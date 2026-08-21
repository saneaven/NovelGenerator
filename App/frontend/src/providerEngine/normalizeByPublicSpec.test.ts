import { describe, expect, it } from 'vitest';

import type { PublicObjectSpec } from './types';
import { normalizeByPublicSpec } from './utils';

const conditionalNumberSpec = {
  kind: 'object',
  expose: true,
  when: [],
  fields: {
    strength: {
      kind: 'number',
      required: false,
      default: 0.7,
      options: [],
      disabled_options: [],
      when: [{ op: 'flag', flag: 'hasReferenceImages' }],
      disabled_when: [],
      ui: null,
    },
  },
} as unknown as PublicObjectSpec;

describe('normalizeByPublicSpec conditional flags', () => {
  it('preserves zero when the field condition is active', () => {
    expect(normalizeByPublicSpec(
      { strength: 0 },
      conditionalNumberSpec,
      { strength: 0 },
      { hasReferenceImages: true },
    )).toEqual({ strength: 0 });
  });

  it('omits the field when the condition is inactive', () => {
    expect(normalizeByPublicSpec(
      { strength: 0 },
      conditionalNumberSpec,
      { strength: 0 },
      { hasReferenceImages: false },
    )).toEqual({});
  });
});
