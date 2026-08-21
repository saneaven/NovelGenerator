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
  promptFormat: 'novelai',
  contextType: 'scene',
  userRequest: 'Show the confrontation.',
};

describe('image prompt journey targets', () => {
  it('keeps the canonical prompt format and selected context IDs', () => {
    const targets = getJourneySpec('sceneImagePrompt').buildEditingTargets({
      ...baseInput,
      selectedContextIds: ['chapter-1', 'timeline-event-1'],
    });

    expect(targets).toMatchObject({
      promptFormat: 'novelai',
      selectedContextIds: ['chapter-1', 'timeline-event-1'],
    });
  });

  it('uses an empty context list when none is supplied', () => {
    const targets = getJourneySpec('sceneImagePrompt').buildEditingTargets(baseInput);
    expect(targets).toMatchObject({ selectedContextIds: [] });
  });
});
