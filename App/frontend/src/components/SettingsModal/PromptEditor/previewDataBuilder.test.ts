import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_URL', 'http://localhost');
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

vi.mock('../../../data/objects/objectCache', () => ({
  readProjectObjectIdsByType: () => ['live-project-object-id'],
}));

const { buildFilteredIds } = await import('./previewDataBuilder');

describe('image prompt preview context IDs', () => {
  it('uses the placeholder project identity space even when live IDs are cached', () => {
    const ids = buildFilteredIds('project-1', true);

    expect(ids.contextObjectIds).toEqual(['live-project-object-id']);
    expect(ids.selectedContextIds).not.toContain('live-project-object-id');
    expect(ids.selectedContextIds).toEqual(ids.selectedEntityIds);
    expect(ids.selectedContextIds).toEqual(expect.arrayContaining([
      '[ placeholder-story-entity-id-2 ]',
      '[ placeholder-chapter-id ]',
      '[ placeholder-manuscript-id ]',
      '[ placeholder-timeline-track-id ]',
      '[ placeholder-timeline-event-id ]',
    ]));
  });

  it('keeps both image context aliases empty when filtered IDs are disabled', () => {
    const ids = buildFilteredIds('project-1', false);

    expect(ids.selectedContextIds).toEqual([]);
    expect(ids.selectedEntityIds).toEqual([]);
  });
});
