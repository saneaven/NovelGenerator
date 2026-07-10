import { describe, expect, it, vi } from 'vitest';
import type { ImagePromptInput } from './journeySpecs';

vi.stubEnv('VITE_API_URL', 'http://localhost');
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { getJourneySpec } = await import('./journeySpecs');

const baseInput: ImagePromptInput = {
  projectId: 'project-1',
  promptMode: 'natural',
  contextType: 'scene',
  userRequest: 'Show the confrontation.',
};

describe('image prompt journey context selection', () => {
  it('uses selectedContextIds as the canonical field and mirrors the legacy alias', () => {
    const targets = getJourneySpec('sceneImagePrompt').buildEditingTargets({
      ...baseInput,
      selectedContextIds: ['chapter-1', 'timeline-event-1'],
      selectedEntityIds: ['legacy-entity-1'],
    });

    expect(targets).toMatchObject({
      selectedContextIds: ['chapter-1', 'timeline-event-1'],
      selectedEntityIds: ['chapter-1', 'timeline-event-1'],
    });
  });

  it('falls back to selectedEntityIds for persisted legacy journeys', () => {
    const targets = getJourneySpec('sceneImagePrompt').buildEditingTargets({
      ...baseInput,
      selectedEntityIds: ['legacy-entity-1'],
    });

    expect(targets).toMatchObject({
      selectedContextIds: ['legacy-entity-1'],
      selectedEntityIds: ['legacy-entity-1'],
    });
  });

  it('does not fall back when selectedContextIds is explicitly empty', () => {
    const targets = getJourneySpec('sceneImagePrompt').buildEditingTargets({
      ...baseInput,
      selectedContextIds: [],
      selectedEntityIds: ['legacy-entity-1'],
    });

    expect(targets).toMatchObject({
      selectedContextIds: [],
      selectedEntityIds: [],
    });
  });
});
