import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ObjectPickerGroup } from './types';
import { getObjectPickerTokenObjectIds } from './objectPickerTokenIds';

describe('getObjectPickerTokenObjectIds', () => {
  it('includes structural parents for manuscript/all mode token requests', () => {
    const groups: ObjectPickerGroup[] = [
      {
        id: 'outline-group',
        label: 'Outline',
        type: 'outline',
        items: [
          { id: 'outline-1', name: 'Outline', type: 'outline', kind: 'outline' },
          { id: 'act-1', name: 'Act', type: 'outline', kind: 'act', parentId: 'outline-1' },
          { id: 'chapter-1', name: 'Chapter', type: 'outline', kind: 'chapter', parentId: 'act-1' },
        ],
      },
    ];

    expect(getObjectPickerTokenObjectIds(groups, new Set(['chapter-1']), 'all')).toEqual([
      'outline-1',
      'act-1',
      'chapter-1',
    ]);
  });

  it('uses selected ids even when summary picker items have no content field', () => {
    const groups: ObjectPickerGroup[] = [
      {
        id: 'entities',
        label: 'Entities',
        type: 'story_entity',
        items: [
          { id: 'entity-1', name: 'Ari', description: 'Pilot', type: 'story_entity' },
        ],
      },
    ];

    expect(getObjectPickerTokenObjectIds(groups, new Set(['entity-1']), 'story-entities')).toEqual(['entity-1']);
  });

  it('keeps ObjectPicker off the text-based token-count path', () => {
    const source = readFileSync(new URL('./ObjectPicker.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('selectedItemsContent');
    expect(source).not.toContain('useTokenCount');
    expect(source).toContain('useObjectContentTokenCount');
  });
});
