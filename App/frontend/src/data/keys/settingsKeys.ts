/** Query-key factory for user settings, scenarios, and search/memory config. */

export const settingsKeys = {
  all: ['settings'] as const,
  settings: () => [...settingsKeys.all, 'global'] as const,
  scenarios: () => [...settingsKeys.all, 'scenario'] as const,
  scenario: (taskType: string, subtype?: string) =>
    [...settingsKeys.scenarios(), taskType, subtype ?? '__default__'] as const,
  searchMemory: () => [...settingsKeys.all, 'searchMemory'] as const,
};
