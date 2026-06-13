import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { CalendarConfig, TimelineTrack } from '../../types/timeline';

vi.stubEnv('VITE_API_URL', 'http://localhost');
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { buildTimelineEventGroups, getTypesForMode } = await import('./useObjectPickerData');

const t = ((key: string, fallback?: string) => fallback ?? key) as TFunction;

const calendar: CalendarConfig = {
  units: [
    { name: 'year', label: 'Year', count: 12 },
    { name: 'month', label: 'Month', count: 30 },
    { name: 'day', label: 'Day' },
  ],
};

function track(): TimelineTrack {
  return {
    id: 'track-1',
    timelineId: 'timeline-1',
    parentId: null,
    position: 0,
    color: 'oklch(0.680 0.140 250.0)',
    createdAt: null,
    updatedAt: null,
    data: {
      English: {
        name: 'Main Track',
        description: 'Track description',
        content: 'Track body',
      },
    },
    version: { id: 'track-version-1', number: 1, createdAt: null },
    events: [
      {
        id: 'event-1',
        trackId: 'track-1',
        startDate: { year: 1, month: 1, day: 1 },
        endDate: null,
        tags: ['beat'],
        createdAt: null,
        updatedAt: null,
        data: {
          English: {
            name: 'Opening Event',
            description: 'Event description',
            content: 'Event body',
          },
        },
        version: { id: 'event-version-1', number: 1, createdAt: null },
        links: [],
      },
    ],
    children: [],
  };
}

describe('useObjectPickerData timeline groups', () => {
  it('includes timeline_track in all and translation modes', () => {
    expect(getTypesForMode('all', [])).toEqual(
      expect.arrayContaining(['timeline_track', 'timeline_event']),
    );
    expect(getTypesForMode('translation', [])).toEqual(
      expect.arrayContaining(['timeline_track', 'timeline_event']),
    );
  });

  it('creates selectable track and event items for the same timeline group', () => {
    const groups = buildTimelineEventGroups([track()], calendar, 'English', 'translation', t);
    const trackGroup = groups[0].childGroups?.[0];

    expect(trackGroup?.items.map((item) => [item.id, item.type])).toEqual([
      ['track-1', 'timeline_track'],
      ['event-1', 'timeline_event'],
    ]);
    expect(trackGroup?.items[0].isGroupParent).toBe(true);
  });
});
