import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMcpStore } from '../../../store/mcpStore';
import {
  buildMcpCreatePayload,
  buildMcpUpdatePayload,
  buildNewMcpDraft,
  hydrateMcpDraft,
  type McpServerDraft,
} from '../PromptEditor/McpServersEditor';
import { makeMcpDraftKey, type DirtyItem, type SaveFailure } from '../PromptEditor/draftTypes';
import { toErrorMessage } from '../PromptEditor/draftUtils';
import { generateTempId } from '../../../utils/tempId';

export interface UseMcpDraftsReturn {
  mcpDrafts: Record<string, McpServerDraft>;
  newMcpDraft: McpServerDraft | null;
  selectedMcpServerId: string | null;
  setSelectedMcpServerId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedMcpKey: string | null;
  currentMcpDraft: McpServerDraft | null;
  selectedMcpSnapshot: ReturnType<typeof useMcpStore.getState>['servers'][number]['snapshot'] | null;
  mcpStoreError: string | null;
  handleCreateMcpServer: () => void;
  onDraftChange: (draft: McpServerDraft) => void;
  onDeleted: (serverId: string) => void;
  onDiscardNew: () => void;
  getDirtyMcp: () => DirtyItem[];
  saveMcp: (activePresetId: string | null) => Promise<{ attempted: number; saved: number; failures: SaveFailure[] }>;
  discardMcp: () => void;
  resetAll: () => void;
  dirtyCount: number;
}

export function useMcpDrafts(): UseMcpDraftsReturn {
  const mcpServers = useMcpStore((s) => s.servers);
  const createServer = useMcpStore((s) => s.createServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const mcpStoreError = useMcpStore((s) => s.error);

  const [mcpDrafts, setMcpDrafts] = useState<Record<string, McpServerDraft>>({});
  const [newMcpDraft, setNewMcpDraft] = useState<McpServerDraft | null>(null);
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null);

  const mcpDraftsRef = useRef(mcpDrafts);
  mcpDraftsRef.current = mcpDrafts;

  // Sync mcpDrafts when mcpServers changes (hydrate non-dirty)
  useEffect(() => {
    setMcpDrafts((prev) => {
      const next: Record<string, McpServerDraft> = {};
      for (const server of mcpServers) {
        const key = makeMcpDraftKey(server.id);
        next[key] = prev[key]?.dirty ? prev[key] : hydrateMcpDraft(server, key);
      }
      return next;
    });
  }, [mcpServers]);

  const selectedMcpKey = useMemo(() => {
    if (!selectedMcpServerId) return null;
    return makeMcpDraftKey(selectedMcpServerId);
  }, [selectedMcpServerId]);

  const currentMcpDraft = selectedMcpKey ? mcpDrafts[selectedMcpKey] : newMcpDraft;

  const selectedMcpSnapshot = useMemo(() => {
    if (!selectedMcpServerId) return null;
    return mcpServers.find((server) => server.id === selectedMcpServerId)?.snapshot ?? null;
  }, [mcpServers, selectedMcpServerId]);

  const handleCreateMcpServer = useCallback(() => {
    if (newMcpDraft) {
      setSelectedMcpServerId(null);
      return;
    }
    setNewMcpDraft(buildNewMcpDraft(makeMcpDraftKey(generateTempId())));
    setSelectedMcpServerId(null);
  }, [newMcpDraft]);

  const onDraftChange = useCallback((draft: McpServerDraft) => {
    if (draft.isNew) {
      setNewMcpDraft(draft);
      return;
    }
    if (!draft.serverId) return;
    const draftKey = makeMcpDraftKey(draft.serverId);
    setMcpDrafts((prev) => ({
      ...prev,
      [draftKey]: draft,
    }));
  }, []);

  const onDeleted = useCallback((serverId: string) => {
    setSelectedMcpServerId((prev) => (prev === serverId ? null : prev));
    setMcpDrafts((prev) => {
      const next = { ...prev };
      delete next[makeMcpDraftKey(serverId)];
      return next;
    });
  }, []);

  const onDiscardNew = useCallback(() => setNewMcpDraft(null), []);

  const getDirtyMcp = useCallback((): DirtyItem[] => {
    const dirty: DirtyItem[] = [];
    for (const d of Object.values(mcpDraftsRef.current)) {
      if (!d.dirty) continue;
      dirty.push({
        kind: 'mcp',
        key: d.draftKey,
        label: d.current.display_name || d.current.server_key || d.draftKey,
        serverId: d.serverId || d.draftKey,
      });
    }
    if (newMcpDraft?.dirty) {
      dirty.push({
        kind: 'mcp',
        key: newMcpDraft.draftKey,
        label: newMcpDraft.current.display_name || newMcpDraft.current.server_key || 'New MCP Server',
        serverId: newMcpDraft.serverId || newMcpDraft.draftKey,
      });
    }
    return dirty;
  }, [newMcpDraft]);

  const saveMcp = useCallback(
    async (activePresetId: string | null): Promise<{ attempted: number; saved: number; failures: SaveFailure[] }> => {
      const failures: SaveFailure[] = [];
      let attempted = 0;
      let saved = 0;

      const dirtyMcpDrafts = [
        ...Object.values(mcpDraftsRef.current).filter((d) => d.dirty),
        ...(newMcpDraft?.dirty ? [newMcpDraft] : []),
      ];
      for (const d of dirtyMcpDrafts) {
        attempted += 1;

        if (d.error) {
          failures.push({
            item: {
              kind: 'mcp',
              key: d.draftKey,
              label: d.current.display_name || d.current.server_key || d.draftKey,
              serverId: d.serverId || d.draftKey,
            },
            error: d.error,
          });
          continue;
        }

        try {
          if (!activePresetId) {
            throw new Error('No active preset selected');
          }
          if (d.isNew) {
            const created = await createServer(activePresetId, buildMcpCreatePayload(d));
            setNewMcpDraft(null);
            setSelectedMcpServerId(created.id);
          } else {
            const updated = await updateServer(activePresetId, d.serverId!, buildMcpUpdatePayload(d));
            setMcpDrafts((prev) => ({
              ...prev,
              [d.draftKey]: hydrateMcpDraft(updated, d.draftKey),
            }));
          }
          saved += 1;
        } catch (error) {
          failures.push({
            item: {
              kind: 'mcp',
              key: d.draftKey,
              label: d.current.display_name || d.current.server_key || d.draftKey,
              serverId: d.serverId || d.draftKey,
            },
            error: toErrorMessage(error),
          });
          if (d.isNew) {
            setNewMcpDraft((prev) =>
              prev?.draftKey === d.draftKey ? { ...prev, error: toErrorMessage(error) } : prev,
            );
          } else {
            setMcpDrafts((prev) => {
              const cur = prev[d.draftKey];
              if (!cur) return prev;
              return {
                ...prev,
                [d.draftKey]: {
                  ...cur,
                  error: toErrorMessage(error),
                  isSyncing: false,
                },
              };
            });
          }
        }
      }

      return { attempted, saved, failures };
    },
    [createServer, newMcpDraft, updateServer],
  );

  const discardMcp = useCallback(() => {
    setMcpDrafts((prev) => {
      const next: Record<string, McpServerDraft> = { ...prev };
      for (const [k, d] of Object.entries(next)) {
        if (!d.dirty) continue;
        next[k] = {
          ...d,
          current: { ...d.original },
          dirty: false,
          error: '',
          isSyncing: false,
        };
      }
      return next;
    });
    setNewMcpDraft(null);
  }, []);

  const resetAll = useCallback(() => {
    setMcpDrafts({});
    setNewMcpDraft(null);
    setSelectedMcpServerId(null);
  }, []);

  const dirtyCount = useMemo(() => {
    return Object.values(mcpDrafts).filter((d) => d.dirty).length + (newMcpDraft?.dirty ? 1 : 0);
  }, [mcpDrafts, newMcpDraft]);

  return {
    mcpDrafts,
    newMcpDraft,
    selectedMcpServerId,
    setSelectedMcpServerId,
    selectedMcpKey,
    currentMcpDraft,
    selectedMcpSnapshot,
    mcpStoreError,
    handleCreateMcpServer,
    onDraftChange,
    onDeleted,
    onDiscardNew,
    getDirtyMcp,
    saveMcp,
    discardMcp,
    resetAll,
    dirtyCount,
  };
}
