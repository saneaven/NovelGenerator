import React, { useMemo, useState } from 'react';
import { TextButton } from '../../TextButton';
import ToggleSwitch from '../../common/ToggleSwitch';
import { CustomSelect } from '../../ui/CustomSelect';
import EditorPanelHeader from './EditorPanelHeader';
import { usePresetStore } from '../../../store/presetStore';
import { useMcpStore } from '../../../store/mcpStore';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import type { McpAuthInput, McpHeaderInput, McpServerCreate, McpServerResponse, McpServerUpdate } from '../../../types/mcp';
import HeaderOverflowMenu from './HeaderOverflowMenu';
import { Trash } from '../../icons';
import './McpServersEditor.css';

type AuthKind = McpAuthInput['auth_kind'];

const AUTH_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'headers', label: 'Headers' },
] as const;

export interface McpServerDraftFields {
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
}

export interface McpServerDraft {
  draftKey: string;
  serverId: string | null;
  isNew: boolean;
  original: McpServerDraftFields;
  current: McpServerDraftFields;
  dirty: boolean;
  error: string;
  isSyncing: boolean;
}

interface McpServersEditorProps {
  draft: McpServerDraft | null;
  snapshot: McpServerResponse['snapshot'] | null;
  storeError?: string | null;
  onDraftChange: (draft: McpServerDraft) => void;
  onDeleted: (serverId: string) => void;
  onDiscardNew: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function fieldsToSnapshot(fields: McpServerDraftFields): string {
  return JSON.stringify({
    server_key: fields.server_key,
    display_name: fields.display_name,
    server_url: fields.server_url,
    enabled: fields.enabled,
    allow_agent_mode: fields.allow_agent_mode,
    allow_plan_mode: fields.allow_plan_mode,
    auth_kind: fields.auth_kind,
    auth_dirty: fields.auth_dirty,
    auth_payload: fields.auth_dirty ? {
      bearer_token: fields.bearer_token,
      headers_text: fields.headers_text,
    } : null,
  });
}

function validateDraft(draft: McpServerDraft): string {
  if (!draft.current.display_name.trim()) return 'Name is required';
  if (!draft.current.server_key.trim()) return 'Key is required';
  if (!draft.current.server_url.trim()) return 'URL is required';
  return '';
}

export function computeMcpDraft(draft: McpServerDraft): McpServerDraft {
  const dirty = draft.isNew || fieldsToSnapshot(draft.current) !== fieldsToSnapshot(draft.original);
  return {
    ...draft,
    dirty,
    error: validateDraft(draft),
  };
}

export function parseHeadersText(value: string): McpHeaderInput[] {
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

function authToDraftFields(server: McpServerResponse): Pick<McpServerDraftFields, 'auth_kind' | 'bearer_token' | 'headers_text' | 'auth_dirty'> {
  if (server.auth_kind === 'bearer') {
    return { auth_kind: 'bearer', bearer_token: '', headers_text: '', auth_dirty: false };
  }
  if (server.auth_kind === 'headers') {
    return { auth_kind: 'headers', bearer_token: '', headers_text: '', auth_dirty: false };
  }
  return { auth_kind: 'none', bearer_token: '', headers_text: '', auth_dirty: false };
}

export function hydrateMcpDraft(server: McpServerResponse, draftKey: string): McpServerDraft {
  const fields: McpServerDraftFields = {
    server_key: server.server_key,
    display_name: server.display_name,
    server_url: server.server_url,
    enabled: server.enabled,
    allow_agent_mode: server.allow_agent_mode,
    allow_plan_mode: server.allow_plan_mode,
    ...authToDraftFields(server),
  };
  return computeMcpDraft({
    draftKey,
    serverId: server.id,
    isNew: false,
    original: { ...fields },
    current: { ...fields },
    dirty: false,
    error: '',
    isSyncing: false,
  });
}

export function buildNewMcpDraft(draftKey: string): McpServerDraft {
  const fields: McpServerDraftFields = {
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
  };
  return computeMcpDraft({
    draftKey,
    serverId: null,
    isNew: true,
    original: { ...fields },
    current: { ...fields },
    dirty: true,
    error: '',
    isSyncing: false,
  });
}

function buildAuth(fields: McpServerDraftFields): McpAuthInput {
  if (fields.auth_kind === 'bearer') {
    return { auth_kind: 'bearer', token: fields.bearer_token };
  }
  if (fields.auth_kind === 'headers') {
    return { auth_kind: 'headers', headers: parseHeadersText(fields.headers_text) };
  }
  return { auth_kind: 'none' };
}

export function buildMcpCreatePayload(draft: McpServerDraft): McpServerCreate {
  return {
    server_key: draft.current.server_key.trim(),
    display_name: draft.current.display_name.trim(),
    server_url: draft.current.server_url.trim(),
    enabled: draft.current.enabled,
    allow_agent_mode: draft.current.allow_agent_mode,
    allow_plan_mode: draft.current.allow_plan_mode,
    auth: buildAuth(draft.current),
  };
}

export function buildMcpUpdatePayload(draft: McpServerDraft): McpServerUpdate {
  const payload: McpServerUpdate = {
    server_key: draft.current.server_key.trim(),
    display_name: draft.current.display_name.trim(),
    server_url: draft.current.server_url.trim(),
    enabled: draft.current.enabled,
    allow_agent_mode: draft.current.allow_agent_mode,
    allow_plan_mode: draft.current.allow_plan_mode,
  };
  if (draft.current.auth_dirty) {
    payload.auth = buildAuth(draft.current);
  }
  return payload;
}

const McpServersEditor: React.FC<McpServersEditorProps> = ({
  draft,
  snapshot,
  storeError,
  onDraftChange,
  onDeleted,
  onDiscardNew,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const activePresetId = usePresetStore((state) => state.activePresetId);
  const { deleteServer, syncServer } = useMcpStore((state) => ({
    deleteServer: state.deleteServer,
    syncServer: state.syncServer,
  }));
  const [actionError, setActionError] = useState('');

  const patchDraft = (patch: Partial<McpServerDraftFields>) => {
    if (!draft) return;
    onDraftChange(computeMcpDraft({
      ...draft,
      current: {
        ...draft.current,
        ...patch,
      },
    }));
  };

  const syncDisabled = useMemo(() => {
    if (!draft) return true;
    return draft.isNew || draft.dirty || draft.isSyncing || !draft.serverId || !activePresetId;
  }, [activePresetId, draft]);

  const handleDelete = async () => {
    if (!draft) return;
    if (draft.isNew || !draft.serverId) {
      onDiscardNew();
      return;
    }

    const ok = await confirm({
      title: 'Delete MCP server',
      message: `Delete "${draft.current.display_name || draft.current.server_key}"?`,
      variant: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;

    try {
      await deleteServer(activePresetId!, draft.serverId);
      onDeleted(draft.serverId);
    } catch (error) {
      await showAlert({
        title: 'Delete MCP server',
        message: error instanceof Error ? error.message : 'Failed to delete MCP server',
        variant: 'danger',
      });
    }
  };

  const handleSync = async () => {
    if (!draft || syncDisabled || !draft.serverId || !activePresetId) return;
    setActionError('');
    onDraftChange({ ...draft, isSyncing: true });
    try {
      await syncServer(activePresetId, draft.serverId);
      onDraftChange({ ...draft, isSyncing: false });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to sync MCP server');
      onDraftChange({ ...draft, isSyncing: false });
    }
  };

  if (!draft) {
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
          <p className="mcp-server-editor__empty-hint">Use the sidebar to browse existing servers or add a new one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mcp-server-editor">
      <EditorPanelHeader
        title={draft.current.display_name || draft.current.server_key || 'New MCP Server'}
        subtitle={draft.current.server_key || 'streamableHttp MCP endpoint'}
        actions={
          <HeaderOverflowMenu
            items={[
              {
                key: draft.isNew ? 'discard-mcp' : 'delete-mcp',
                icon: <Trash size="sm" />,
                label: draft.isNew ? 'Discard' : 'Delete',
                onClick: handleDelete,
                variant: 'danger',
              },
            ]}
          />
        }
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />

      <div className="mcp-server-editor__content">
        {storeError && <div className="mcp-server-editor__error">{storeError}</div>}
        {draft.error && <div className="mcp-server-editor__error">{draft.error}</div>}
        {actionError && <div className="mcp-server-editor__error">{actionError}</div>}

        <section className="mcp-server-card">
          <div className="mcp-server-card__grid">
            <label className="mcp-server-card__field">
              <span>Name</span>
              <input
                value={draft.current.display_name}
                onChange={(event) => patchDraft({ display_name: event.target.value })}
                placeholder="Docs MCP"
              />
            </label>

            <label className="mcp-server-card__field">
              <span>Key</span>
              <input
                value={draft.current.server_key}
                onChange={(event) => patchDraft({ server_key: event.target.value })}
                placeholder="docs_mcp"
              />
            </label>
          </div>

          <label className="mcp-server-card__field">
            <span>URL</span>
            <input
              value={draft.current.server_url}
              onChange={(event) => patchDraft({ server_url: event.target.value })}
              placeholder="https://example.com/mcp"
            />
          </label>

          <div className="mcp-server-card__toggles">
            <ToggleSwitch
              checked={draft.current.enabled}
              onChange={(checked) => patchDraft({ enabled: checked })}
              label="Enabled"
            />
            <ToggleSwitch
              checked={draft.current.allow_agent_mode}
              onChange={(checked) => patchDraft({ allow_agent_mode: checked })}
              label="Agent"
            />
            <ToggleSwitch
              checked={draft.current.allow_plan_mode}
              onChange={(checked) => patchDraft({ allow_plan_mode: checked })}
              label="Plan"
            />
          </div>

          <div className="mcp-server-card__auth">
            <label className="mcp-server-card__field">
              <span>Auth</span>
              <CustomSelect
                className="mcp-server-card__select"
                value={draft.current.auth_kind}
                onChange={(value) => patchDraft({
                  auth_kind: value as AuthKind,
                  auth_dirty: true,
                })}
                options={[...AUTH_OPTIONS]}
              />
            </label>

            {draft.current.auth_kind === 'bearer' && (
              <label className="mcp-server-card__field">
                <span>Bearer token</span>
                <input
                  value={draft.current.bearer_token}
                  onChange={(event) => patchDraft({
                    bearer_token: event.target.value,
                    auth_dirty: true,
                  })}
                  placeholder="Paste token"
                />
              </label>
            )}

            {draft.current.auth_kind === 'headers' && (
              <label className="mcp-server-card__field">
                <span>Headers</span>
                <textarea
                  value={draft.current.headers_text}
                  onChange={(event) => patchDraft({
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
              <strong>Last sync:</strong> {snapshot?.synced_at ?? 'Never'}
            </div>
            <div>
              <strong>Catalog:</strong>{' '}
              {snapshot
                ? `${snapshot.catalog.prompts.length} prompts / ${snapshot.catalog.resources.length} resources / ${snapshot.catalog.tools.length} tools`
                : 'No snapshot'}
            </div>
            {snapshot?.sync_error && <div className="mcp-server-card__sync-error">{snapshot.sync_error}</div>}
          </div>
        </section>
      </div>

      <div className="mcp-server-editor__footer">
        <TextButton
          variant="secondary"
          onClick={() => void handleSync()}
          disabled={syncDisabled}
          loading={draft.isSyncing}
        >
          Sync
        </TextButton>
      </div>
    </div>
  );
};

export default McpServersEditor;
