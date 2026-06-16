/**
 * TanStack Query reads for prompt presets and their preset-scoped children.
 *
 * `activePresetId` is server-driven (the presets list's `is_active` flag), so
 * `useActivePresetId` derives it from `usePresetsQuery` — no client slice.
 *
 * variables / subAgents / mcpServers are keyed by `presetId`, so switching the
 * active preset re-points every consumer at fresh cache keys. That keying is
 * what replaces the old `presetStore.setActivePreset` cross-store reset cascade.
 */

import { useQuery } from '@tanstack/react-query';
import { presetService } from '../../api/presetService';
import { variableService } from '../../api/variableService';
import { subAgentService } from '../../api/subAgentService';
import { mcpService } from '../../api/mcpService';
import { presetKeys } from '../keys/presetKeys';
import { selectActivePresetId } from './presetSelectors';
import type { PresetListItem } from '../../types/presets';
import type { PromptVariable } from '../../types/variables';
import type { SubAgentDefinition } from '../../types/subAgents';
import type { McpServerResponse } from '../../types/mcp';

const EMPTY_PRESETS: PresetListItem[] = [];

/** All presets for the current user. */
export function usePresetsQuery() {
  return useQuery({
    queryKey: presetKeys.list(),
    queryFn: () => presetService.getAllPresets(),
  });
}

/** Reactive presets list (empty until loaded). */
export function usePresets(): PresetListItem[] {
  return usePresetsQuery().data ?? EMPTY_PRESETS;
}

/** Reactive active-preset id (the list's `is_active` entry), or null. */
export function useActivePresetId(): string | null {
  const { data } = usePresetsQuery();
  return selectActivePresetId(data);
}

/** The active preset list item, or undefined. */
export function useActivePreset(): PresetListItem | undefined {
  const presets = usePresets();
  return presets.find((p) => p.is_active);
}

/**
 * Prompt variables for a preset. Keyed by `presetId` (pass the ACTIVE preset
 * id) so the active-preset switch points this at a fresh key.
 */
export function useVariablesQuery(presetId: string | null | undefined) {
  return useQuery({
    queryKey: presetKeys.variables(presetId ?? '__none__'),
    queryFn: () => variableService.getAllVariables(),
    enabled: Boolean(presetId),
  });
}

/** Sub-agent definitions for a preset (keyed by the ACTIVE preset id). */
export function useSubAgentsQuery(presetId: string | null | undefined) {
  return useQuery({
    queryKey: presetKeys.subAgents(presetId ?? '__none__'),
    queryFn: () => subAgentService.list(),
    enabled: Boolean(presetId),
  });
}

/** MCP servers for a preset (keyed by — and fetched for — the given preset). */
export function useMcpServersQuery(presetId: string | null | undefined) {
  return useQuery({
    queryKey: presetKeys.mcpServers(presetId ?? '__none__'),
    queryFn: () => mcpService.list(presetId as string),
    enabled: Boolean(presetId),
  });
}

const EMPTY_VARIABLES: PromptVariable[] = [];
const EMPTY_SUB_AGENTS: SubAgentDefinition[] = [];
const EMPTY_MCP_SERVERS: McpServerResponse[] = [];

/** Reactive variables for a preset (empty until loaded). */
export function useVariables(presetId: string | null | undefined): PromptVariable[] {
  return useVariablesQuery(presetId).data ?? EMPTY_VARIABLES;
}

/** Reactive sub-agents for a preset (empty until loaded). */
export function useSubAgents(presetId: string | null | undefined): SubAgentDefinition[] {
  return useSubAgentsQuery(presetId).data ?? EMPTY_SUB_AGENTS;
}

/** Reactive MCP servers for a preset, sorted by display name (empty until loaded). */
export function useMcpServers(presetId: string | null | undefined): McpServerResponse[] {
  return useMcpServersQuery(presetId).data ?? EMPTY_MCP_SERVERS;
}
