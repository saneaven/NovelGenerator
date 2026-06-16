/**
 * Query-key factory for timeline configuration (calendar).
 * Timeline tracks/events are unified objects → use objectKeys.collection(...).
 */

export const timelineKeys = {
  all: ['timeline'] as const,
  config: (projectId: string) => [...timelineKeys.all, 'config', projectId] as const,
};
