/** Query-key factory for journeys (automation runs, per project). */

export const journeyKeys = {
  all: ['journeys'] as const,
  runs: (projectId: string) => [...journeyKeys.all, 'runs', projectId] as const,
};
