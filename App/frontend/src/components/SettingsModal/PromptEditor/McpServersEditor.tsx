import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TextButton } from '../../TextButton';
import ToggleSwitch from '../../common/ToggleSwitch';
import { CustomSelect } from '../../ui/CustomSelect';
import EditorPanelHeader from './EditorPanelHeader';
import { usePresetStore } from '../../../store/presetStore';
import { useMcpStore } from '../../../store/mcpStore';
import { confirm } from '../../../store/dialogStore';
import type { McpAuthInput, McpHeaderInput, McpServerCreate, McpServerResponse, McpServerUpdate } from '../../../types/mcp';
import './McpServersEditor.css';

type AuthKind = McpAuthInput['auth_kind'];

const AUTH_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'headers', label: 'Headers' },
] as const;

interface McpServerDraft {
  id: string;
  server_key: string;
  display_name: string;
  server_url: string;
  enabled: boolean;
  allow_agent_mode: boolean;
  allow_plan_mode: boolean;
  auth_kind: AuthKind;
  bearer_token: string;
  headers_text: string;
  auth_dirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  isSyncing: boolean;
  error: string;
}

interface McpServersEditorProps {
  selectedId: string | null;
  isCreatingNew: boolean;
  onCreated: (serverId: string) => void;
  onDeleted: (serverId: string) => void;
  onCancelCreate: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function parseHeadersText(value: string): McpHeaderInput[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) {
        return { name: line, value: '' };
      }
      return {
        name: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((item) => item.name);
}

function authToDraftFields(server: McpServerResponse): Pick<McpServerDraft, 'auth_kind' | 'bearer_token' | 'headers_text'> {
  if (server.auth_kind === 'bearer') {
    return { auth_kind: 'bearer', bearer_token: '', headers_text: '' };
  }
  if (server.auth_kind === 'headers') {
    return { auth_kind: 'headers', bearer_token: '', headers_text: '' };
  }
  return { auth_kind: 'none', bearer_token: '', headers_text: '' };
}

function serverToDraft(server: McpServerResponse): McpServerDraft {
  return {
    id: server.id,
    server_key: server.server_key,
    display_name: server.display_name,
    server_url: server.server_url,
    enabled: server.enabled,
    allow_agent_mode: server.allow_agent_mode,
    allow_plan_mode: server.allow_plan_mode,
    ...authToDraftFields(server),
    auth_dirty: false,
    isNew: false,
    isSaving: false,
    isSyncing: false,
    error: '',
  };
}

function buildAuth(draft: McpServerDraft): McpAuthInput {
  if (draft.auth_kind === 'bearer') {
    return { auth_kind: 'bearer', token: draft.bearer_token };
  }
  if (draft.auth_kind === 'headers') {
    return { auth_kind: 'headers', headers: parseHeadersText(draft.headers_text) };
  }
  return { auth_kind: 'none' };
}

function buildCreatePayload(draft: McpServerDraft): McpServerCreate {
  return {
    server_key: draft.server_key.trim(),
    display_name: draft.display_name.trim(),
    server_url: draft.server_url.trim(),
    enabled: draft.enabled,
    allow_agent_mode: draft.allow_agent_mode,
    allow_plan_mode: draft.allow_plan_mode,
    auth: buildAuth(draft),
  };
}

function buildUpdatePayload(draft: McpServerDraft): McpServerUpdate {
  const payload: McpServerUpdate = {
    server_key: draft.server_key.trim(),
    display_name: draft.display_name.trim(),
    server_url: draft.server_url.trim(),
    enabled: draft.enabled,
    allow_agent_mode: draft.allow_agent_mode,
    allow_plan_mode: draft.allow_plan_mode,
  };
  if (draft.auth_dirty) {
    payload.auth = buildAuth(draft);
  }
  return payload;
}

function emptyDraft(): McpServerDraft {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `mcp-${Date.now()}`;
  return {
    id,
    server_key: '',
    display_name: '',
    server_url: '',
    enabled: true,
    allow_agent_mode: true,
    allow_plan_mode: true,
    auth_kind: 'none',
    bearer_token: '',
    headers_text: '',
    auth_dirty: false,
    isNew: true,
    isSaving: false,
    isSyncing: false,
    error: '',
  };
}

const McpServersEditor: React.FC<McpServersEditorProps> = ({
  selectedId,
  isCreatingNew,
  onCreated,
  onDeleted,
  onCancelCreate,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const activePresetId = usePresetStore((state) => state.activePresetId);
  const { servers, ensureLoaded, createServer, updateServer, deleteServer, syncServer, error } = useMcpStore(useShallow((state) => ({
    servers: state.servers,
    ensureLoaded: state.ensureLoaded,
    createServer: state.createServer,
    updateServer: state.updateServer,
    deleteServer: state.deleteServer,
    syncServer: state.syncServer,
    error: state.error,
  })));
  const [drafts, setDrafts] = useState<Record<string, McpServerDraft>>({});
  const [newDraft, setNewDraft] = useState<McpServerDraft | null>(null);

  useEffect(() => {
    if (!activePresetId) return;
    void ensureLoaded(activePresetId).catch(() => {});
  }, [activePresetId, ensureLoaded]);

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, McpServerDraft> = {};
      for (const server of servers) {
        next[server.id] = prev[server.id]
          ? { ...prev[server.id], ...serverToDraft(server), isSaving: false, isSyncing: false }
          : serverToDraft(server);
      }
      return next;
    });
  }, [servers]);

  useEffect(() => {
    if (!isCreatingNew) return;
    setNewDraft((prev) => prev ?? emptyDraft());
  }, [isCreatingNew]);

  const selectedServer = useMemo(() => {
    if (!selectedId) return null;
    return servers.find((server) => server.id === selectedId) ?? null;
  }, [selectedId, servers]);

  const activeDraft = useMemo(() => {
    if (isCreatingNew) {
      return newDraft;
    }
    if (!selectedId) return null;
    return drafts[selectedId] ?? (selectedServer ? serverToDraft(selectedServer) : null);
  }, [drafts, isCreatingNew, newDraft, selectedId, selectedServer]);

  const activeSnapshot = selectedServer?.snapshot ?? null;

  const patchSelectedDraft = (patch: Partial<McpServerDraft>) => {
    if (isCreatingNew) {
      setNewDraft((prev) => (prev ? { ...prev, ...patch } : { ...emptyDraft(), ...patch }));
      return;
    }
    if (!selectedId) return;
    setDrafts((prev) => {
      const base = prev[selectedId] ?? (selectedServer ? serverToDraft(selectedServer) : null);
      if (!base) return prev;
      return {
        ...prev,
        [selectedId]: { ...base, ...patch },
      };
    });
  };

  const handleSave = async () => {
    if (!activePresetId || !activeDraft) return;

    patchSelectedDraft({ isSaving: true, error: '' });
    try {
      if (activeDraft.isNew) {
        const created = await createServer(activePresetId, buildCreatePayload(activeDraft));
        setNewDraft(null);
        setDrafts((prev) => ({ ...prev, [created.id]: serverToDraft(created) }));
        onCreated(created.id);
        return;
      }

      const updated = await updateServer(activePresetId, activeDraft.id, buildUpdatePayload(activeDraft));
      setDrafts((prev) => ({ ...prev, [updated.id]: serverToDraft(updated) }));
    } catch (saveError) {
      patchSelectedDraft({
        isSaving: false,
        error: saveError instanceof Error ? saveError.message : 'Failed to save MCP server',
      });
      return;
    }

    patchSelectedDraft({ isSaving: false, error: '' });
  };

  const handleSync = async () => {
    if (!activePresetId || !activeDraft || activeDraft.isNew) return;

    patchSelectedDraft({ isSyncing: true, error: '' });
    try {
      const updated = await syncServer(activePresetId, activeDraft.id);
      setDrafts((prev) => ({ ...prev, [updated.id]: serverToDraft(updated) }));
    } catch (syncError) {
      patchSelectedDraft({
        isSyncing: false,
        error: syncError instanceof Error ? syncError.message : 'Failed to sync MCP server',
      });
      return;
    }

    patchSelectedDraft({ isSyncing: false, error: '' });
  };

  const handleDelete = async () => {
    if (!activeDraft) return;

    if (activeDraft.isNew) {
      setNewDraft(null);
      onCancelCreate();
      return;
    }

    if (!activePresetId) return;
    const ok = await confirm({
      title: 'Delete MCP server',
      message: `Delete "${activeDraft.display_name || activeDraft.server_key}"?`,
      variant: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;

    await deleteServer(activePresetId, activeDraft.id);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[activeDraft.id];
      return next;
    });
    onDeleted(activeDraft.id);
  };

  if (!activeDraft) {
    return (
      <div className="mcp-server-editor mcp-server-editor--empty">
        <EditorPanelHeader
          title="MCP Servers"
          subtitle="Select an MCP server from the sidebar."
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
        />
        <div className="mcp-server-editor__empty-state">
          <p>Select an MCP server to edit.</p>
          <p className="mcp-server-editor__empty-hint">
            Use the sidebar to browse existing servers or add a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mcp-server-editor">
      <EditorPanelHeader
        title={activeDraft.display_name || activeDraft.server_key || 'New MCP Server'}
        subtitle={activeDraft.server_key || 'streamableHttp MCP endpoint'}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />

      <div className="mcp-server-editor__content">
        {error && <div className="mcp-server-editor__error">{error}</div>}
        {activeDraft.error && <div className="mcp-server-editor__error">{activeDraft.error}</div>}

        <section className="mcp-server-card">
          <div className="mcp-server-card__grid">
            <label className="mcp-server-card__field">
              <span>Name</span>
              <input
                value={activeDraft.display_name}
                onChange={(event) => patchSelectedDraft({ display_name: event.target.value })}
                placeholder="Docs MCP"
              />
            </label>

            <label className="mcp-server-card__field">
              <span>Key</span>
              <input
                value={activeDraft.server_key}
                onChange={(event) => patchSelectedDraft({ server_key: event.target.value })}
                placeholder="docs_mcp"
              />
            </label>
          </div>

          <label className="mcp-server-card__field">
            <span>URL</span>
            <input
              value={activeDraft.server_url}
              onChange={(event) => patchSelectedDraft({ server_url: event.target.value })}
              placeholder="https://example.com/mcp"
            />
          </label>

          <div className="mcp-server-card__toggles">
            <ToggleSwitch
              checked={activeDraft.enabled}
              onChange={(checked) => patchSelectedDraft({ enabled: checked })}
              label="Enabled"
            />
            <ToggleSwitch
              checked={activeDraft.allow_agent_mode}
              onChange={(checked) => patchSelectedDraft({ allow_agent_mode: checked })}
              label="Agent"
            />
            <ToggleSwitch
              checked={activeDraft.allow_plan_mode}
              onChange={(checked) => patchSelectedDraft({ allow_plan_mode: checked })}
              label="Plan"
            />
          </div>

          <div className="mcp-server-card__auth">
            <label className="mcp-server-card__field">
              <span>Auth</span>
              <CustomSelect
                className="mcp-server-card__select"
                value={activeDraft.auth_kind}
                onChange={(value) => patchSelectedDraft({
                  auth_kind: value as AuthKind,
                  auth_dirty: true,
                })}
                options={[...AUTH_OPTIONS]}
              />
            </label>

            {activeDraft.auth_kind === 'bearer' && (
              <label className="mcp-server-card__field">
                <span>Bearer token</span>
                <input
                  value={activeDraft.bearer_token}
                  onChange={(event) => patchSelectedDraft({
                    bearer_token: event.target.value,
                    auth_dirty: true,
                  })}
                  placeholder="Paste token"
                />
              </label>
            )}

            {activeDraft.auth_kind === 'headers' && (
              <label className="mcp-server-card__field">
                <span>Headers</span>
                <textarea
                  value={activeDraft.headers_text}
                  onChange={(event) => patchSelectedDraft({
                    headers_text: event.target.value,
                    auth_dirty: true,
                  })}
                  rows={4}
                  placeholder={'Authorization: Bearer ...\nX-Custom: value'}
                />
              </label>
            )}
          </div>
        </section>

        <section className="mcp-server-card">
          <div className="mcp-server-card__section-title">Snapshot</div>
          <div className="mcp-server-card__status">
            <div>
              <strong>Last sync:</strong> {activeSnapshot?.synced_at ?? 'Never'}
            </div>
            <div>
              <strong>Catalog:</strong>{' '}
              {activeSnapshot
                ? `${activeSnapshot.catalog.prompts.length} prompts / ${activeSnapshot.catalog.resources.length} resources / ${activeSnapshot.catalog.tools.length} tools`
                : 'No snapshot'}
            </div>
            {activeSnapshot?.sync_error && (
              <div className="mcp-server-card__sync-error">{activeSnapshot.sync_error}</div>
            )}
          </div>
        </section>
      </div>

      <div className="mcp-server-editor__footer">
        <TextButton
          variant="primary"
          onClick={() => void handleSave()}
          disabled={activeDraft.isSaving}
          loading={activeDraft.isSaving}
        >
          Save
        </TextButton>
        <TextButton
          variant="secondary"
          onClick={() => void handleSync()}
          disabled={activeDraft.isNew || activeDraft.isSyncing}
          loading={activeDraft.isSyncing}
        >
          Sync
        </TextButton>
        <TextButton
          variant={activeDraft.isNew ? 'ghost' : 'danger'}
          onClick={() => void handleDelete()}
        >
          {activeDraft.isNew ? 'Discard' : 'Delete'}
        </TextButton>
      </div>
    </div>
  );
};

export default McpServersEditor;
