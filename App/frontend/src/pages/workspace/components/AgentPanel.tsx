import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buildEditCardsFromToolCallMetadata } from '../../../toolCall';
import { FunctionCallsThread } from '../../../toolCall/ui';
import type { ToolCallDecisionMap } from '../../../toolCall/types';
import type { ToolCallMetadata } from '../../../types/chat';
import { resolveRunMessageDisplay, type ThreadMessage, type ThreadToolCall } from '../../../types/thread';
import { useAgentStore } from '../../../store/agentStore';
import { useAgentUIStore } from '../../../store/agentUIStore';
import { useDisplayLanguageStore } from '../../../store/displayLanguageStore';
import { useSettings } from '../../../store/settingsStore';
import { useThreadStore } from '../../../store/threadStore';
import ChatEngine from '../../../agent/chatEngine';
import { SubAgentPeekDock } from '../../../components/SubAgentPeek/SubAgentPeekDock';
import '../../../pages/workspace/styles/AgentPanel.css';
import '../../../pages/workspace/styles/AgentHeader.css';
import '../../../pages/workspace/styles/AgentMessages.css';
import '../../../pages/workspace/styles/AgentInput.css';

interface AgentPanelProps {
  projectId: string;
  surface?: string;
}

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.id,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status,
    reason: toolCall.reason ?? undefined,
    result: (toolCall.result ?? undefined) as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function getTextForMessage(message: ThreadMessage, language: string, fallbackLanguage?: string): string {
  const resolved = message.isStreaming
    ? {
        contentParts: message.data._streaming?.contentParts ?? [],
      }
    : resolveRunMessageDisplay(message, language, fallbackLanguage);
  return resolved.contentParts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('')
    .trim();
}

function hasBlockingToolCall(toolCalls: ThreadToolCall[]): boolean {
  return toolCalls.some((tc) => ['pending', 'streaming', 'validating', 'processing'].includes(tc.status));
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ projectId, surface }) => {
  const settings = useSettings();
  const preferredDisplayLanguage = useDisplayLanguageStore((state) => state.preferredDisplayLanguage);
  const displayLanguage = preferredDisplayLanguage || settings.mainLanguage;

  const selectedAgent = useAgentStore((state) => state.getSelectedAgent(projectId));
  const threadId = selectedAgent?.thread_id ?? null;

  const input = useAgentUIStore((state) => state.inputByProject[projectId] ?? '');
  const setInput = useAgentUIStore((state) => state.setInput);
  const runMode = useAgentUIStore((state) => state.runModeByProject[projectId] ?? 'agentMode');
  const setRunMode = useAgentUIStore((state) => state.setRunMode);

  const { thread, messages, toolCallsByMessageId, isStreamActive } = useThreadStore(
    useShallow((state) => ({
      thread: threadId ? state.threadsById[threadId] : undefined,
      messages: threadId ? state.messagesByThreadId[threadId] : undefined,
      toolCallsByMessageId: state.toolCallsByMessageId,
      isStreamActive: threadId ? Boolean(state.activeStreamByThread[threadId]) : false,
    })),
  );

  const engineRef = useRef<ChatEngine | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!threadId) {
      engineRef.current?.disconnectSSE();
      engineRef.current = null;
      return;
    }

    const engine = new ChatEngine({
      threadId,
      projectId,
      threadType: 'agent',
    });
    engineRef.current = engine;
    void engine.init().catch((error) => {
      console.error('Failed to init chat engine', { threadId, error });
    });

    return () => {
      if (engineRef.current === engine) {
        engine.disconnectSSE();
        engineRef.current = null;
      }
    };
  }, [threadId, projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages?.length, isStreamActive]);

  const orderedMessages = useMemo(
    () => [...(messages ?? [])].sort((a, b) => a.seqInThread - b.seqInThread),
    [messages],
  );

  const lastAssistantMessageId = useMemo(() => {
    for (let i = orderedMessages.length - 1; i >= 0; i--) {
      if (orderedMessages[i].role === 'assistant') return orderedMessages[i].id;
    }
    return null;
  }, [orderedMessages]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!engineRef.current || !threadId) return;

      const text = input;
      const shouldClear = text.trim().length > 0;
      await engineRef.current.send(text, {
        run_mode: runMode,
        surface,
      });
      if (shouldClear) {
        setInput(projectId, '');
      }
    },
    [threadId, input, runMode, surface, setInput, projectId],
  );

  const handleCommitDecisions = useCallback(
    async (decisions: ToolCallDecisionMap) => {
      if (!engineRef.current) return;
      const accepts = Object.entries(decisions)
        .filter(([, d]) => d === 'accept')
        .map(([id]) => id);
      const rejects = Object.entries(decisions)
        .filter(([, d]) => d === 'reject')
        .map(([id]) => id);

      if (accepts.length > 1 && rejects.length === 0) {
        await engineRef.current.acceptToolCallsBatch(accepts);
        return;
      }

      await Promise.all([
        ...accepts.map((id) => engineRef.current?.acceptToolCall(id)),
        ...rejects.map((id) => engineRef.current?.rejectToolCall(id)),
      ]);
    },
    [],
  );

  return (
    <section className="agent-panel">
      <header className="agent-header">
        <div className="agent-header-left">
          <strong>{selectedAgent?.name ?? 'Agent'}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="agent-context-dropdown-trigger"
            onClick={() => setRunMode(projectId, runMode === 'planMode' ? 'agentMode' : 'planMode')}
          >
            {runMode === 'planMode' ? 'Plan' : 'Agent'}
          </button>
          <span className="agent-context-dropdown-trigger">
            {thread?.status ?? 'done'}
          </span>
        </div>
      </header>

      <div className="agent-messages">
        {orderedMessages.length === 0 && (
          <div className="welcome-message">
            <div className="message-content">
              Ask anything to start a new run.
            </div>
          </div>
        )}

        {orderedMessages.map((message, index) => {
          if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool_result') {
            return null;
          }

          const toolCalls = message.role === 'assistant'
            ? (toolCallsByMessageId[message.id] ?? [])
            : [];
          const cards = toolCalls.length > 0
            ? buildEditCardsFromToolCallMetadata(toolCalls.map(toToolCallMetadata))
            : [];
          const pending = hasBlockingToolCall(toolCalls);
          const mode = message.isStreaming
            ? 'streaming'
            : pending
              ? 'pending'
              : 'confirmed';

          const previous = index > 0 ? orderedMessages[index - 1] : null;
          const sameRole = previous?.role === message.role;
          const text = getTextForMessage(message, displayLanguage, settings.defaultSubLanguage ?? undefined);
          const isLatestAssistant = message.role === 'assistant' && message.id === lastAssistantMessageId;
          const hasSubAgentCalls = toolCalls.some((tc) => tc.toolName.startsWith('call_') && Boolean(tc.childThreadId));

          return (
            <div
              key={message.id}
              className={`agent-message ${message.role === 'assistant' || message.role === 'tool_result' ? 'assistant' : 'user'}${sameRole ? ' same-role-as-previous' : ''}`}
            >
              <div className="message-wrapper">
                {!sameRole && (
                  <div className="message-header">
                    <span className="message-role">{message.role === 'user' ? 'User' : 'Assistant'}</span>
                    <span className="message-time">{new Date(message.createdAt).toLocaleTimeString()}</span>
                  </div>
                )}

                <div className="message-content">
                  {text || (message.isStreaming ? '...' : '')}
                </div>

                {cards.length > 0 && (
                  <div className="message-function-calls">
                    <FunctionCallsThread
                      threadId={`${threadId ?? 'thread'}:${message.id}`}
                      mode={mode}
                      cards={cards}
                      onCommitDecisions={mode === 'pending' ? handleCommitDecisions : undefined}
                      projectId={projectId}
                    />
                  </div>
                )}

                {hasSubAgentCalls && threadId && isLatestAssistant && (
                  <SubAgentPeekDock
                    parentThreadId={threadId}
                    parentMessageId={message.id}
                    projectId={projectId}
                    isActiveParent={true}
                  />
                )}
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      <div className="agent-input-container">
        <form className="agent-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <textarea
              className="agent-input"
              value={input}
              onChange={(event) => setInput(projectId, event.target.value)}
              placeholder="Type a message. Empty submit resumes the latest run."
              rows={1}
            />
            <button className="agent-submit-btn" type="submit" disabled={!threadId}>
              Send
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

export default AgentPanel;
