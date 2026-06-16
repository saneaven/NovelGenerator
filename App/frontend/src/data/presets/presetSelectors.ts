/**
 * Pure selectors + non-React cache reads over the preset query caches.
 *
 * `activePresetId` is server-driven: the presets list carries an `is_active`
 * flag (the backend owns which preset is active). We therefore derive the
 * active id from the cached presets list rather than holding a client slice.
 *
 * The non-React readers mirror `data/objects/objectCache.ts` — they only see
 * what queries have already fetched, for the handful of non-React callers
 * (tool-call module display, prompt-preview builder) that previously reached
 * into `useSubAgentStore.getState()` / `useVariableStore.getState()`.
 */

import { queryClient } from '../queryClient';
import { presetKeys } from '../keys/presetKeys';
import type { PresetListItem } from '../../types/presets';
import type { PromptVariable } from '../../types/variables';
import type { SubAgentDefinition } from '../../types/subAgents';

/** Active preset id from a presets list (the one flagged `is_active`), or null. */
export function selectActivePresetId(presets: PresetListItem[] | undefined): string | null {
  return presets?.find((p) => p.is_active)?.id ?? null;
}

/** Read the cached presets list (empty until fetched). */
export function readPresetsFromCache(): PresetListItem[] {
  return queryClient.getQueryData<PresetListItem[]>(presetKeys.list()) ?? [];
}

/** Active preset id from the query cache (null if unfetched or none active). */
export function readActivePresetIdFromCache(): string | null {
  return selectActivePresetId(readPresetsFromCache());
}

/** Cached prompt variables for the active preset (empty if unfetched). */
export function readVariablesFromCache(): PromptVariable[] {
  const activeId = readActivePresetIdFromCache();
  if (!activeId) return [];
  return queryClient.getQueryData<PromptVariable[]>(presetKeys.variables(activeId)) ?? [];
}

/** Variables as a `{ name: value }` map for the template engine. */
export function readVariablesForTemplate(): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const variable of readVariablesFromCache()) {
    result[variable.name] = variable.value;
  }
  return result;
}

/** Cached sub-agents for the active preset (empty if unfetched). */
export function readSubAgentsFromCache(): SubAgentDefinition[] {
  const activeId = readActivePresetIdFromCache();
  if (!activeId) return [];
  return queryClient.getQueryData<SubAgentDefinition[]>(presetKeys.subAgents(activeId)) ?? [];
}

/** A single cached sub-agent by its `agent_name` (tool suffix), or undefined. */
export function readSubAgentByAgentName(agentName: string): SubAgentDefinition | undefined {
  return readSubAgentsFromCache().find((s) => s.agent_name === agentName);
}
