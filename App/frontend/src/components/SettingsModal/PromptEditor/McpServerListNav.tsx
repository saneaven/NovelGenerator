import React, { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePresetStore } from '../../../store/presetStore';
import { useMcpStore } from '../../../store/mcpStore';
import { Globe, Plus } from '../../icons';
import { TextButton } from '../../TextButton';
import './McpServerListNav.css';

interface McpServerListNavProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose?: () => void;
}

const McpServerListNav: React.FC<McpServerListNavProps> = ({
  selectedId,
  onSelect,
  onCreate,
  onClose,
}) => {
  const activePresetId = usePresetStore((state) => state.activePresetId);
  const { servers, ensureLoaded, isLoading } = useMcpStore(useShallow((state) => ({
    servers: state.servers,
    ensureLoaded: state.ensureLoaded,
    isLoading: state.isLoading,
  })));

  useEffect(() => {
    if (!activePresetId) return;
    void ensureLoaded(activePresetId).catch(() => {});
  }, [activePresetId, ensureLoaded]);

  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => {
      const left = (a.display_name || a.server_key || '').trim();
      const right = (b.display_name || b.server_key || '').trim();
      return left.localeCompare(right);
    });
  }, [servers]);

  return (
    <div className="mcp-server-list-nav">
      {onClose && (
        <header className="mcp-server-list-nav__header">
          <h3 className="mcp-server-list-nav__title">MCP Servers</h3>
        </header>
      )}

      <div className="mcp-server-list-nav__list">
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
