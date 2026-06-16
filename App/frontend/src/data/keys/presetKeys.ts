/**
 * Query-key factory for prompt presets and their preset-scoped children.
 *
 * variables/subAgents/mcpServers are keyed by `presetId` so switching the
 * active preset naturally points consumers at fresh keys — replacing the old
 * cross-store reset cascade in presetStore.setActivePreset.
 */

export const presetKeys = {
  all: ['presets'] as const,
  list: () => [...presetKeys.all, 'list'] as const,
  detail: (presetId: string) => [...presetKeys.all, 'detail', presetId] as const,
  variables: (presetId: string) => [...presetKeys.all, 'variables', presetId] as const,
  subAgents: (presetId: string) => [...presetKeys.all, 'subAgents', presetId] as const,
  mcpServers: (presetId: string) => [...presetKeys.all, 'mcpServers', presetId] as const,
};
