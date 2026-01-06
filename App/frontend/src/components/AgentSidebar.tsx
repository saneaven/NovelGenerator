import React, { useEffect, useRef, useState } from 'react';
import { useAgentStore, type Agent } from '../store/agentStore';
import { useSidebarStore } from '../store/sidebarStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { getBestLanguageData } from '../utils/languageData';
import { BaseSidebar } from './BaseSidebar';
import { IconButton } from './IconButton';
import { SpeechBubble, Plus, Trash, Edit, Close } from './icons';
import './AgentSidebar.css';

interface AgentSidebarProps {
  projectId: string;
  onSelectAgent: (agentId: string) => void;
}

const AgentSidebar: React.FC<AgentSidebarProps> = ({
  projectId,
  onSelectAgent,
}) => {
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const {
    createAgent,
    getAgents,
    getSelectedAgentId,
    selectAgent,
    renameAgent,
    deleteAgent,
  } = useAgentStore();
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const agents = getAgents(projectId);
  const selectedAgentId = getSelectedAgentId(projectId);

  useEffect(() => {
    if (editingAgentId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingAgentId]);

  const handleCreateAgent = async () => {
    const newAgentId = await createAgent(projectId);
    onSelectAgent(newAgentId);
  };

  const handleSelectAgentInternal = (agentId: string) => {
    selectAgent(projectId, agentId);
    onSelectAgent(agentId);
  };

  const handleSaveEdit = () => {
    if (editingAgentId && editName.trim()) {
      renameAgent(projectId, editingAgentId, editName.trim());
    }
    setEditingAgentId(null);
    setEditName('');
  };

  const handleCancelEdit = () => {
    setEditingAgentId(null);
    setEditName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const resolvePreviewContent = (agent: Agent): string => {
    if (!agent.messages || agent.messages.length === 0) {
      return 'No messages yet';
    }

    const lastMessage = agent.messages[agent.messages.length - 1];
    const mainLanguage = settings.mainLanguage;
    const defaultSubLanguage = settings.defaultSubLanguage ?? undefined;

    const extractText = (messageData: any): string => {
      const parts = messageData.contentParts || [];
      return parts
        .filter((p: any) => p.type === 'content')
        .map((p: any) => p.text)
        .join(' ');
    };

    if (lastMessage.data[mainLanguage]) {
      const content = extractText(lastMessage.data[mainLanguage]);
      return content.length > 50 ? `${content.substring(0, 50)}...` : content || 'No content';
    }

    const fallback = getBestLanguageData(lastMessage.data, mainLanguage, defaultSubLanguage);
    if (fallback) {
      const content = extractText(fallback.data);
      return content.length > 50 ? `${content.substring(0, 50)}...` : content || 'No content';
    }

    const availableLanguages = Object.keys(lastMessage.data);
    if (availableLanguages.length > 0) {
      const content = extractText(lastMessage.data[availableLanguages[0]]);
      return content.length > 50 ? `${content.substring(0, 50)}...` : content || 'No content';
    }

    return 'No messages yet';
  };

  const formatTime = (date: Date | string): string => {
    const now = new Date();
    const targetDate = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(targetDate.getTime())) {
      return 'Unknown';
    }

    const diffMs = now.getTime() - targetDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return targetDate.toLocaleDateString();
  };

  const handleClose = () => {
    closeSidebar(projectId);
  };

  const sidebarHeader = (
    <div className="agent-sidebar-header">
      <div className="sidebar-title">
        <h3>Agents</h3>
      </div>
      <div className="sidebar-controls">
        <IconButton
          icon={<Plus size="sm" />}
          onClick={handleCreateAgent}
          title="Create new agent"
          size="sm"
          className="new-agent-btn"
        />
        <IconButton
            icon={<Close size="sm" />}
            onClick={handleClose}
            title="Close sidebar"
            size="sm"
            variant="ghost"
            className="close-sidebar-btn"
        />
      </div>
    </div>
  );

  return (
    <BaseSidebar
      id="agent"
      projectId={projectId}
      position="left"
      className="agent-sidebar"
      header={sidebarHeader}
      onClose={handleClose}
    >
      <div className="agent-list">
        {agents.map((agent, index) => {
             // Dynamic style for staggered animation
             const style = {
                animationDelay: `${Math.min(index * 0.05, 0.5)}s`
             } as React.CSSProperties;

             return (
              <div
                key={agent.id}
                className={`agent-item ${selectedAgentId === agent.id ? 'selected' : ''}`}
                onClick={() => handleSelectAgentInternal(agent.id)}
                style={style}
              >
                <div className="agent-item-icon">
                  <SpeechBubble size="sm" />
                </div>
                <div className="agent-item-main">
                  {editingAgentId === agent.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={handleSaveEdit}
                      onKeyDown={handleKeyDown}
                      className="agent-name-edit"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="agent-name">{agent.name}</div>
                      <div className="agent-preview">{resolvePreviewContent(agent)}</div>
                      <div className="agent-time">{formatTime(agent.updated_at)}</div>
                    </>
                  )}
                </div>

                {editingAgentId !== agent.id && (
                  <div
                    className="agent-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      icon={<Edit size="xs" />}
                      onClick={() => {
                        setEditingAgentId(agent.id);
                        setEditName(agent.name);
                      }}
                      title="Rename agent"
                      size="xs"
                    />
                    <IconButton
                      icon={<Trash size="xs" />}
                      onClick={() => {
                        if (agents.length <= 1) {
                          showError('Warning', 'Cannot delete the last agent');
                          return;
                        }
                        if (confirm('Are you sure you want to delete this agent?')) {
                          deleteAgent(projectId, agent.id);
                          const remainingAgents = getAgents(projectId);
                          if (remainingAgents.length > 0) {
                            const newSelectedId = getSelectedAgentId(projectId);
                            if (newSelectedId) {
                              onSelectAgent(newSelectedId);
                            }
                          }
                        }
                      }}
                      title="Delete agent"
                      disabled={agents.length <= 1}
                      size="xs"
                      variant="danger"
                    />
                  </div>
                )}
              </div>
            );
        })}
      </div>
    </BaseSidebar>
  );
};

export default AgentSidebar;
