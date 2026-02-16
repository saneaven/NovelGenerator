import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type Agent, getAgentLastActivityAt } from '../../store/agentStore';
import { makeProjectAgentKey, useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSettings } from '../../store/settingsStore';
import { useErrorStore } from '../../store/errorStore';
import type { TaskSessionState } from '../../llmTask/types';
import { useRuntimeStore, resolveRunMessageDisplay, type Run, type RunMessage } from '../../runtime';
import { BaseSidebar } from '../BaseSidebar';
import { IconButton } from '../IconButton';
import { SpeechBubble, Plus, Trash, Edit, Close } from '../icons';
import './AgentSidebar.css';

interface AgentSidebarProps {
  projectId: string;
  onSelectAgent: (agentId: string) => void;
}

type AnySession = TaskSessionState<any, any>;

type AgentSidebarSignals = {
  isRunning: boolean;
  hasCompletedSinceViewed: boolean;
  hasPendingToolRequest: boolean;
};

const RUNNING_SESSION_STATUSES = new Set(['running', 'applying']);
const TERMINAL_SESSION_STATUSES = new Set(['success', 'error', 'cancelled']);
const PENDING_TOOL_STATUSES = new Set(['pending', 'running']);
const BLOCKING_SUB_AGENT_STATUSES = new Set(['running', 'waiting', 'paused', 'error']);

function getSessionAgentId(session: AnySession): string | null {
  const agentId = (session.input as any)?.agentId;
  return typeof agentId === 'string' && agentId ? agentId : null;
}

function hasPendingRunToolCallsForAgent(params: {
  agentId: string;
  projectId: string;
  runsById: Record<string, Run | undefined>;
  runMessagesByRunId: Record<string, RunMessage[] | undefined>;
  runToolCallsByMessageId: Record<string, Array<{ status: string }> | undefined>;
}): boolean {
  const { agentId, projectId, runsById, runMessagesByRunId, runToolCallsByMessageId } = params;

  for (const run of Object.values(runsById)) {
    if (!run) continue;
    if (run.projectId !== projectId) continue;
    if (run.agentId !== agentId) continue;
    if (run.runType !== 'agent') continue;

    const messages = runMessagesByRunId[run.id] ?? [];
    for (const message of messages) {
      const toolCalls = runToolCallsByMessageId[message.id] ?? [];
      for (const toolCall of toolCalls) {
        if (PENDING_TOOL_STATUSES.has(String(toolCall?.status ?? ''))) {
          return true;
        }
      }
    }
  }

  return false;
}

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
  const { showError } = useErrorStore();

  const projectAgentSessions = useLLMSessionStore(
    useShallow((state) => {
      const sessions: AnySession[] = [];
      for (const session of Object.values(state.sessions)) {
        if (!session) continue;
        if (session.kind !== 'agent') continue;
        const inputProjectId = (session.input as any)?.projectId;
        if (inputProjectId !== projectId) continue;
        sessions.push(session);
      }
      return sessions;
    })
  );
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const agents = getAgents(projectId);
  const selectedAgentId = getSelectedAgentId(projectId);
  const { runsById, runMessagesByRunId, runToolCallsByMessageId } = useRuntimeStore(
    useShallow((state) => ({
      runsById: state.runsById,
      runMessagesByRunId: state.runMessagesByRunId,
      runToolCallsByMessageId: state.runToolCallsByMessageId,
    })),
  );
  const blockingSubAgentByAgentId = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const agent of agents) {
      result[agent.id] = false;
    }

    for (const run of Object.values(runsById)) {
      if (!run) continue;
      if (run.runType !== 'subAgent') continue;
      if (!agents.some((agent) => agent.id === run.agentId)) continue;
      if (!BLOCKING_SUB_AGENT_STATUSES.has(run.status)) continue;
      result[run.agentId] = true;
    }

    return result;
  }, [agents, runsById]);

  const agentSignalsById = useMemo<Record<string, AgentSidebarSignals>>(() => {
    const sessionsByAgent: Record<string, AnySession[]> = {};
    for (const session of projectAgentSessions) {
      const sessionAgentId = getSessionAgentId(session);
      if (!sessionAgentId) continue;
      const existing = sessionsByAgent[sessionAgentId] ?? [];
      existing.push(session);
      sessionsByAgent[sessionAgentId] = existing;
    }

    const signals: Record<string, AgentSidebarSignals> = {};
    for (const agent of agents) {
      const isSelectedAgent = selectedAgentId === agent.id;
      const key = makeProjectAgentKey(projectId, agent.id);
      const sessions = sessionsByAgent[agent.id] ?? [];
      const lastViewedAt = lastViewedAtByProjectAgent[key] ?? 0;

      const isRunningFromSession = sessions.some((session) => RUNNING_SESSION_STATUSES.has(session.status));
      const isRunningFromPreflight = loadingByProjectAgent[key] === true;
      const hasCompletedSinceViewed = sessions.some(
        (session) =>
          TERMINAL_SESSION_STATUSES.has(session.status) &&
          (session.updatedAt ?? 0) > lastViewedAt
      );
      const hasPendingToolRequestFromSession = sessions.some((session) => {
        return session.status === 'running' || session.status === 'applying';
      });
      const hasPendingToolRequestFromMessage = hasPendingRunToolCallsForAgent({
        agentId: agent.id,
        projectId,
        runsById,
        runMessagesByRunId,
        runToolCallsByMessageId: runToolCallsByMessageId as Record<string, Array<{ status: string }> | undefined>,
      });
      const hasPendingToolRequestFromSubAgent = blockingSubAgentByAgentId[agent.id] ?? false;

      signals[agent.id] = {
        isRunning: isRunningFromSession || isRunningFromPreflight,
        hasCompletedSinceViewed: isSelectedAgent ? false : hasCompletedSinceViewed,
        hasPendingToolRequest: hasPendingToolRequestFromSession || hasPendingToolRequestFromMessage || hasPendingToolRequestFromSubAgent,
      };
    }
    return signals;
  }, [
    agents,
    selectedAgentId,
    projectId,
    projectAgentSessions,
    loadingByProjectAgent,
    lastViewedAtByProjectAgent,
    blockingSubAgentByAgentId,
    runsById,
    runMessagesByRunId,
    runToolCallsByMessageId,
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

    // Find the latest root run for this agent and get its last message
    const rootRuns = Object.values(runsById)
      .flatMap((value) => {
        if (!value) return [];
        if (value.projectId !== projectId) return [];
        if (value.agentId !== agent.id) return [];
        if (value.runType !== 'agent') return [];
        return [value];
      })
      .sort((a, b) => {
        const aSeq = a.rootRunSeq ?? Number.MAX_SAFE_INTEGER;
        const bSeq = b.rootRunSeq ?? Number.MAX_SAFE_INTEGER;
        if (aSeq !== bSeq) return aSeq - bSeq;
        return a.createdAt.localeCompare(b.createdAt);
      });

    if (rootRuns.length === 0) return t('agent.sidebar.noMessagesYet');

    const latestRun = rootRuns[rootRuns.length - 1];
    const messages = runMessagesByRunId[latestRun.id] ?? [];
    if (messages.length === 0) return t('agent.sidebar.noMessagesYet');

    const lastMessage = messages[messages.length - 1];
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
                      onClick={() => {
                        if (agents.length <= 1) {
                          showError(t('common.warning'), t('agent.sidebar.cannotDeleteLast'));
                          return;
                        }
                        if (confirm(t('agent.sidebar.deleteConfirm'))) {
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
