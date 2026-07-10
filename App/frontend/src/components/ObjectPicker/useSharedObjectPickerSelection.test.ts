import { describe, expect, it, vi } from 'vitest';
import type { UnifiedObject } from '../../types/unifiedObject';

vi.stubEnv('VITE_API_URL', 'http://localhost');
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { getAllModeSelectableIds } = await import('./useSharedObjectPickerSelection');

function object(
  id: string,
  type: UnifiedObject['type'],
  kind?: UnifiedObject['kind'],
): UnifiedObject {
  return { id, type, kind } as UnifiedObject;
}

describe('getAllModeSelectableIds', () => {
  it('includes only the shared all-mode object contract and de-duplicates IDs', () => {
    expect(getAllModeSelectableIds([
      object('basic', 'basic_info'),
      object('guidelines', 'guidelines'),
      object('folder', 'story_entity_folder'),
      object('entity', 'story_entity', 'character'),
      object('outline-root', 'outline', 'outline'),
      object('act', 'outline', 'act'),
      object('chapter', 'outline', 'chapter'),
      object('manuscript', 'manuscript'),
      object('track', 'timeline_track'),
      object('event', 'timeline_event'),
      object('event', 'timeline_event'),
    ])).toEqual(['entity', 'chapter', 'manuscript', 'track', 'event']);
  });
});
