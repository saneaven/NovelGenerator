/** Query-key factory for provider specs. */

export const providerKeys = {
  all: ['providers'] as const,
  specs: () => [...providerKeys.all, 'specs'] as const,
};
