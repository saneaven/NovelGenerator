/** Query-key factory for image runs (one accumulate-never-drop map per project). */

export const imageRunKeys = {
  all: ['imageRuns'] as const,
  map: (projectId: string) => [...imageRunKeys.all, 'map', projectId] as const,
};
