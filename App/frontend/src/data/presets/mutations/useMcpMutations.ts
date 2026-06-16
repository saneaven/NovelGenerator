/**
 * MCP-server CRUD + sync, scoped to a preset.
 *
 * Each mutation writes the `presetKeys.mcpServers(presetId)` cache directly,
 * keeping the list sorted by display name (as the old mcpStore did).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpService } from '../../../api/mcpService';
import { presetKeys } from '../../keys/presetKeys';
import type {
  McpServerCreate,
  McpServerResponse,
  McpServerUpdate,
} from '../../../types/mcp';

function sortByDisplayName(servers: McpServerResponse[]): McpServerResponse[] {
  return [...servers].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export function useCreateMcpServerMutation(presetId: string) {
  const qc = useQueryClient();
  const key = presetKeys.mcpServers(presetId);
  return useMutation({
    mutationFn: (data: McpServerCreate) => mcpService.create(presetId, data),
    onSuccess: (created) => {
      qc.setQueryData<McpServerResponse[]>(key, (prev) =>
        sortByDisplayName(prev ? [...prev, created] : [created]),
      );
    },
  });
}

export interface UpdateMcpServerVars {
  serverId: string;
  data: McpServerUpdate;
}

export function useUpdateMcpServerMutation(presetId: string) {
  const qc = useQueryClient();
  const key = presetKeys.mcpServers(presetId);
  return useMutation({
    mutationFn: ({ serverId, data }: UpdateMcpServerVars) => mcpService.update(presetId, serverId, data),
    onSuccess: (updated) => {
      qc.setQueryData<McpServerResponse[]>(key, (prev) =>
        sortByDisplayName((prev ?? []).map((s) => (s.id === updated.id ? updated : s))),
      );
    },
  });
}

export function useDeleteMcpServerMutation(presetId: string) {
  const qc = useQueryClient();
  const key = presetKeys.mcpServers(presetId);
  return useMutation({
    mutationFn: (serverId: string) => mcpService.delete(presetId, serverId),
    onSuccess: (_res, serverId) => {
      qc.setQueryData<McpServerResponse[]>(key, (prev) => prev?.filter((s) => s.id !== serverId));
    },
  });
}

export function useSyncMcpServerMutation(presetId: string) {
  const qc = useQueryClient();
  const key = presetKeys.mcpServers(presetId);
  return useMutation({
    mutationFn: (serverId: string) => mcpService.sync(presetId, serverId),
    onSuccess: (updated) => {
      qc.setQueryData<McpServerResponse[]>(key, (prev) =>
        sortByDisplayName((prev ?? []).map((s) => (s.id === updated.id ? updated : s))),
      );
    },
  });
}
