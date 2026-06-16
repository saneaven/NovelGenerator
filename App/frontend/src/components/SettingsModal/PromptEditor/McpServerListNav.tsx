import React, { useMemo } from 'react';
import { useActivePresetId, useMcpServersQuery } from '../../../data/presets';
import { Globe, Plus } from '../../icons';
import { TextButton } from '../../TextButton';
import './McpServerListNav.css';

interface McpServerListNavProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  newDraftLabel?: string | null;
  isNewDraftSelected?: boolean;
  onSelectNewDraft?: () => void;
}

const McpServerListNav: React.FC<McpServerListNavProps> = ({
  selectedId,
  onSelect,
  onCreate,
  newDraftLabel,
  isNewDraftSelected,
  onSelectNewDraft,
}) => {
  const activePresetId = useActivePresetId();
  const { data: servers = [], isLoading } = useMcpServersQuery(activePresetId);

  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => {
      const left = (a.display_name || a.server_key || '').trim();
      const right = (b.display_name || b.server_key || '').trim();
      return left.localeCompare(right);
    });
  }, [servers]);

  return (
    <div className="mcp-server-list-nav">
      <div className="mcp-server-list-nav__list">
        {newDraftLabel && (
          <button
            type="button"
            className={`mcp-server-item ${isNewDraftSelected ? 'mcp-server-item--selected' : ''}`}
            onClick={onSelectNewDraft}
          >
            <span className="mcp-server-item__icon">
              <Plus size="sm" />
            </span>
            <span className="mcp-server-item__name">{newDraftLabel}</span>
            <span className="mcp-server-item__key">Unsaved</span>
            <span className="mcp-server-item__meta">Save to create this server</span>
          </button>
        )}
        {isLoading && sortedServers.length === 0 ? (
          <div className="mcp-server-list-nav__loading">Loading...</div>
        ) : sortedServers.length === 0 ? (
          <div className="mcp-server-list-nav__empty">
            <p>No MCP servers configured yet.</p>
            <p className="mcp-server-list-nav__empty-hint">
              Add a streamable HTTP MCP endpoint for this preset.
            </p>
          </div>
        ) : (
          sortedServers.map((server) => {
            const snapshot = server.snapshot;
            const promptCount = snapshot?.catalog.prompts.length ?? 0;
            const resourceCount = snapshot?.catalog.resources.length ?? 0;
            const toolCount = snapshot?.catalog.tools.length ?? 0;
            return (
              <button
                key={server.id}
                type="button"
                className={`mcp-server-item ${selectedId === server.id ? 'mcp-server-item--selected' : ''}`}
                onClick={() => onSelect(server.id)}
              >
                <span className="mcp-server-item__icon">
                  <Globe size="sm" />
                </span>
                <span className="mcp-server-item__name">
                  {server.display_name || server.server_key}
                  {!server.enabled && <span className="mcp-server-item__badge">Disabled</span>}
                </span>
                <span className="mcp-server-item__key">{server.server_key}</span>
                <span className="mcp-server-item__meta">
                  {`${promptCount} prompts / ${resourceCount} resources / ${toolCount} tools`}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="mcp-server-list-nav__footer">
        <TextButton iconLeft={<Plus size="sm" />} onClick={onCreate}>
          Add MCP Server
        </TextButton>
      </div>
    </div>
  );
};

export default McpServerListNav;
