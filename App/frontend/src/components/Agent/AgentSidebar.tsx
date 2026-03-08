import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type Agent, getAgentLastActivityAt } from '../../store/agentStore';
import { makeProjectAgentKey, useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useSettings } from '../../store/settingsStore';
import { useThreadStore } from '../../store/threadStore';
import { resolveRunMessageDisplay } from '../../types/thread';
import { BaseSidebar } from '../BaseSidebar';
import { IconButton } from '../IconButton';
import { SpeechBubble, Plus, Trash, Edit, Close } from '../icons';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import './AgentSidebar.css';

interface AgentSidebarProps {
  projectId: string;
  onSelectAgent: (agentId: string) => void;
}

type AgentSidebarSignals = {
  isRunning: boolean;
  hasCompletedSinceViewed: boolean;
  hasPendingToolRequest: boolean;
};

const AgentSidebar: React.FC<AgentSidebarProps> = ({
  projectId,
  onSelectAgent,
}) => {
  const { t } = useTranslation();
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const markAgentViewed = useAgentUIStore((state) => state.markAgentViewed);
  const loadingByProjectAgent = useAgentUIStore((state) => state.loadingByProjectAgent);
  const lastViewedAtByProjectAgent = useAgentUIStore((state) => state.lastViewedAtByProjectAgent);
  const {
    createAgent,
    getAgents,
    getSelectedAgentId,
    selectAgent,
    renameAgent,
    deleteAgent,
  } = useAgentStore();
  const settings = useSettings();
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const agents = getAgents(projectId);
  const selectedAgentId = getSelectedAgentId(projectId);

  const { threadsById, messagesByThreadId, toolCallsByMessageId } = useThreadStore(
    useShallow((state) => ({
      threadsById: state.threadsById,
      messagesByThreadId: state.messagesByThreadId,
      toolCallsByMessageId: state.toolCallsByMessageId,
    })),
  );

  const agentSignalsById = useMemo<Record<string, AgentSidebarSignals>>(() => {
    const signals: Record<string, AgentSidebarSignals> = {};
    for (const agent of agents) {
      const threadId = agent.thread_id;
      const key = makeProjectAgentKey(projectId, agent.id);
      const lastViewedAt = lastViewedAtByProjectAgent[key] ?? 0;
      const isRunningFromPreflight = loadingByProjectAgent[key] === true;

      const threadInfo = threadId ? threadsById[threadId] : undefined;
      const threadStatus = threadInfo?.status;
      const isRunning = threadStatus === 'running' || isRunningFromPreflight;

      // Has completed since viewed: runtime timestamp moved forward while thread is done.
      const messages = threadId ? messagesByThreadId[threadId] : undefined;
      const latestMessage = messages?.length ? messages[messages.length - 1] : undefined;
      const latestMessageTime = latestMessage ? new Date(latestMessage.createdAt).getTime() : 0;
      const latestRuntimeMessageTime = threadInfo?.latestMessageAt
        ? new Date(threadInfo.latestMessageAt).getTime()
        : 0;
      const latestRuntimeUpdateTime = threadInfo?.updatedAt
        ? new Date(threadInfo.updatedAt).getTime()
        : 0;
      const latestActivityTime = Math.max(latestMessageTime, latestRuntimeMessageTime, latestRuntimeUpdateTime);
      const hasCompletedSinceViewed =
        selectedAgentId !== agent.id &&
        threadStatus === 'done' &&
        latestActivityTime > lastViewedAt;

      // Pending tool requests: unresolved count from runtime snapshot first, fallback to local message scan.
      const runtimeUnresolved = Number(threadInfo?.unresolvedToolCallCount ?? 0);
      let hasPendingToolRequest = runtimeUnresolved > 0 || threadStatus === 'waiting';
      if (!hasPendingToolRequest && messages) {
        for (const msg of messages) {
          const tcs = toolCallsByMessageId[msg.id];
          if (!tcs) continue;
          for (const tc of tcs) {
            if (
              tc.status === 'pending'
              || tc.status === 'streaming'
              || tc.status === 'validating'
              || tc.status === 'processing'
              || tc.status === 'working'
            ) {
              hasPendingToolRequest = true;
              break;
            }
          }
          if (hasPendingToolRequest) break;
        }
      }

      signals[agent.id] = {
        isRunning,
        hasCompletedSinceViewed,
        hasPendingToolRequest,
      };
    }
    return signals;
  }, [
    agents,
    selectedAgentId,
    projectId,
    threadsById,
    messagesByThreadId,
    toolCallsByMessageId,
    loadingByProjectAgent,
    lastViewedAtByProjectAgent,
  ]);

  useEffect(() => {
    if (editingAgentId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingAgentId]);

  const handleCreateAgent = async () => {
    const newAgentId = await createAgent(projectId);
    markAgentViewed(projectId, newAgentId);
    onSelectAgent(newAgentId);
  };

  const handleSelectAgentInternal = (agentId: string) => {
    selectAgent(projectId, agentId);
    markAgentViewed(projectId, agentId);
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
    const mainLanguage = settings.mainLanguage;
    const defaultSubLanguage = settings.defaultSubLanguage ?? undefined;

    if (!agent.thread_id) return t('agent.sidebar.noMessagesYet');
    const messages = messagesByThreadId[agent.thread_id];
    if (!messages || messages.length === 0) return t('agent.sidebar.noMessagesYet');

    // Find last user/assistant message (skip delta, tool_call, system)
    let lastMessage = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.id.startsWith('delta:')) continue;
      if (m.role === 'user' || m.role === 'assistant') {
        lastMessage = m;
        break;
      }
    }
    if (!lastMessage) return t('agent.sidebar.noMessagesYet');

    const resolved = resolveRunMessageDisplay(lastMessage, mainLanguage, defaultSubLanguage);
    const content = resolved.contentParts
      .filter(p => p.type === 'content')
      .map(p => p.text)
      .join(' ');

    return content.length > 50 ? `${content.substring(0, 50)}...` : content || t('agent.sidebar.noContent');
  };

  const formatTime = (date: Date | string): string => {
    const now = new Date();
    const targetDate = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(targetDate.getTime())) {
      return t('agent.sidebar.unknownTime');
    }

    const diffMs = now.getTime() - targetDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return t('agent.sidebar.justNow');
    if (diffMins < 60) return t('agent.sidebar.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('agent.sidebar.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('agent.sidebar.daysAgo', { count: diffDays });

    return targetDate.toLocaleDateString();
  };

  const handleClose = () => {
    closeSidebar(projectId);
  };

  const sidebarHeader = (
    <div className="agent-sidebar-header">
      <div className="sidebar-title">
        <h3>{t('agent.agents')}</h3>
      </div>
      <div className="sidebar-controls">
        <IconButton
          icon={<Plus size="sm" />}
          onClick={handleCreateAgent}
          title={t('agent.sidebar.createAgent')}
          size="sm"
          className="new-agent-btn"
        />
        <IconButton
            icon={<Close size="sm" />}
            onClick={handleClose}
            title={t('agent.sidebar.closeSidebar')}
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
             const signals = agentSignalsById[agent.id] ?? {
                isRunning: false,
                hasCompletedSinceViewed: false,
                hasPendingToolRequest: false,
             };
             const hasAnySignal = signals.isRunning || signals.hasCompletedSinceViewed || signals.hasPendingToolRequest;

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
                      {hasAnySignal && (
                        <div className="agent-status-row">
                          {signals.isRunning && <span className="agent-status-chip running">{t('agent.sidebar.status.running')}</span>}
                          {signals.hasCompletedSinceViewed && <span className="agent-status-chip done">{t('agent.sidebar.status.done')}</span>}
                          {signals.hasPendingToolRequest && <span className="agent-status-chip tools">{t('agent.sidebar.status.tools')}</span>}
                        </div>
                      )}
                      <div className="agent-preview">{resolvePreviewContent(agent)}</div>
                      <div className="agent-time">{formatTime(getAgentLastActivityAt(agent))}</div>
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
                      title={t('agent.sidebar.renameAgent')}
                      size="xs"
                    />
                    <IconButton
                      icon={<Trash size="xs" />}
                      onClick={async () => {
                        if (agents.length <= 1) {
                          showAlert({ title: t('common.warning'), message: t('agent.sidebar.cannotDeleteLast') });
                          return;
                        }
                        const confirmed = await confirm({
                          title: 'Delete Agent',
                          message: t('agent.sidebar.deleteConfirm'),
                          variant: 'danger',
                          confirmLabel: 'Delete',
                        });
                        if (confirmed) {
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
                      title={t('agent.sidebar.deleteAgent')}
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
