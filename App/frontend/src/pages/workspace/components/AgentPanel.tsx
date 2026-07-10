import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useSelectionStore } from '../../../store/selectionStore';
import { useSelectedAgent } from '../../../data/agents';
import { useUiStore } from '../../../store/uiStore';
import { useSettings } from '../../../data/settings';
import {
  useActivePresetId,
  useMcpServers,
  useSubAgentsQuery,
  useSyncMcpServerMutation,
} from '../../../data/presets';
import { useEditorStore } from '../../../store/editorStore';
import { useThreadView } from '../../../data/threads';
import { ensureTimelineLoaded } from '../../../data/timeline';
import { computeParentClosure } from '../../../utils/parentClosure';
import { useProjectObjectsMapState } from '../../../data/objects/useProjectObjectsMap';
import {
  cancelThread,
  sendThreadMessage,
} from '../../../runtime/threadCommands';
import {
  ObjectPicker,
  getAllModeSelectableIds,
  useSharedObjectPickerSelection,
} from '../../../components/ObjectPicker';
import AgentSidebar from '../../../components/Agent/AgentSidebar';
import type { AgentRunMode } from '../../../types/agentRuntime';
import type { ThreadToolCall } from '../../../types/thread';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import AuthenticatedImage from '../../../components/common/AuthenticatedImage';
import ThreadMessageList from '../../../components/ThreadConversation/ThreadMessageList';
import AgentRunModeToggle from '../../../components/ui/AgentRunModeToggle';
import { DropdownItem, DropdownMenu } from '../../../components/ui/DropdownMenu';
import { BaseModal } from '../../../components/BaseModal';
import {
  Settings,
  ChevronDown,
  Send,
  Stop,
  Plus,
  Upload,
  Document,
  Image as ImageIcon,
  Text,
  Close,
} from '../../../components/icons';
import '../../../pages/workspace/styles/AgentPanel.css';
import '../../../pages/workspace/styles/AgentHeader.css';
import { alert as showAlert } from '../../../store/dialogStore';
import '../../../pages/workspace/styles/AgentInput.css';
import { useThreadLiveViewState } from '../../../hooks/useThreadLiveViewState';
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_FILE_BYTES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  createPendingAttachment,
  formatAttachmentSize,
  isSupportedAttachmentMimeType,
  revokeAttachmentPreview,
  type PendingAttachment,
} from '../../../utils/threadAttachments';
import type { McpCatalogPrompt, McpCatalogResource, McpSelection, McpServerResponse } from '../../../types/mcp';

interface AgentPanelProps {
  projectId: string;
  surface?: string;
  displayLanguage: string;
}

interface ToolCallBlockingSummary {
  count: number;
  firstMessageId?: string;
}

type SendBlockReason = 'missing_agent' | 'running' | 'pending_tool_calls' | 'context_loading' | null;

interface SendBlockingState {
  blocked: boolean;
  reason: SendBlockReason;
  unresolvedToolCalls: ToolCallBlockingSummary;
}

interface PendingPromptSelection {
  server: McpServerResponse;
  prompt: McpCatalogPrompt;
  values: Record<string, string>;
}

interface AgentContextTriggerProps {
  selectedCount: number;
  totalCount: number;
  isOpen: boolean;
  onClick: () => void;
}

interface AgentInputFormProps {
  projectId: string;
  hasSelectedAgent: boolean;
  isMessageRunActive: boolean;
  isSendBlocked: boolean;
  sendBlockedReason?: string | null;
  pendingAttachments: PendingAttachment[];
  selectedMcpSelections: McpSelection[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPrepareMcpMenu: () => void;
  onOpenAttachmentPicker: () => void;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveMcpSelection: (selectionId: string) => void;
  onSelectMcpPrompt: (server: McpServerResponse, prompt: McpCatalogPrompt) => void;
  onSelectMcpResource: (server: McpServerResponse, resource: McpCatalogResource) => void;
  availableMcpServers: McpServerResponse[];
  onSubmit: (e: React.FormEvent, input: string) => Promise<void>;
  onStop: () => void;
}

const BLOCKING_TOOL_CALL_STATUSES = new Set(['pending', 'streaming', 'validating', 'processing', 'working']);

function isBlockingToolCallStatus(status: string | undefined): boolean {
  if (!status) return false;
  return BLOCKING_TOOL_CALL_STATUSES.has(status);
}

function summarizeToolCallBlocking(
  messageIds: string[],
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>,
  latestRunId?: string | null,
  runtimeUnresolvedCount: number = 0,
): ToolCallBlockingSummary {
  let localCount = 0;
  let firstMessageId: string | undefined;

  for (const messageId of messageIds) {
    const toolCalls = toolCallsByMessageId[messageId] ?? [];
    for (const toolCall of toolCalls) {
      // Only block sending for unresolved tool calls from the latest run.
      if (latestRunId && toolCall.runId && toolCall.runId !== latestRunId) continue;
      if (!isBlockingToolCallStatus(toolCall.status)) continue;
      localCount += 1;
      if (!firstMessageId) {
        firstMessageId = messageId;
      }
    }
  }

  const count = runtimeUnresolvedCount > 0 ? runtimeUnresolvedCount : localCount;
  return { count, firstMessageId };
}

const AgentContextTrigger: React.FC<AgentContextTriggerProps> = React.memo(({
  selectedCount,
  totalCount,
  isOpen,
  onClick,
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`agent-context-dropdown-trigger ${isOpen ? 'open' : ''}`}
      onClick={onClick}
      aria-expanded={isOpen}
      aria-haspopup="listbox"
    >
      <span className={`agent-context-dropdown-arrow ${isOpen ? 'open' : ''}`}>
        <ChevronDown size="xs" />
      </span>
      <Settings size="sm" />
      <span>{t('agent.context')} ({selectedCount}/{totalCount})</span>
    </button>
  );
});

const PendingAttachmentCard: React.FC<{
  attachment: PendingAttachment;
  onRemove: (attachmentId: string) => void;
}> = React.memo(({ attachment, onRemove }) => {
  const { t } = useTranslation();

  return (
    <div className={`agent-composer-attachment-card agent-composer-attachment-card--${attachment.kind}`}>
      <div className="agent-composer-attachment-preview" aria-hidden="true">
        {attachment.kind === 'image' && attachment.previewUrl ? (
          <AuthenticatedImage
            src={attachment.previewUrl}
            alt={attachment.name}
            className="agent-composer-attachment-image"
          />
        ) : (
          attachment.kind === 'image'
            ? <ImageIcon size="md" />
            : attachment.kind === 'text_file'
              ? <Text size="md" />
              : <Document size="md" />
        )}
      </div>
      <div className="agent-composer-attachment-meta">
        <div className="agent-composer-attachment-name" title={attachment.name}>
          {attachment.name}
        </div>
        <div className="agent-composer-attachment-size">
          {formatAttachmentSize(attachment.size)}
        </div>
      </div>
      <IconButton
        icon={<Close size="xs" />}
        variant="ghost"
        size="xs"
        onClick={() => onRemove(attachment.clientId)}
        title={t('agent.removeAttachment')}
        className="agent-composer-attachment-remove"
      />
    </div>
  );
});

function selectionSummaryLabel(selection: McpSelection): string {
  return selection.kind === 'prompt' ? selection.prompt_name : selection.resource_uri;
}

const ComposerMcpChipRow: React.FC<{
  selections: McpSelection[];
  onRemove: (selectionId: string) => void;
}> = React.memo(({ selections, onRemove }) => {
  if (selections.length === 0) return null;
  return (
    <div className="agent-composer-mcp-chips">
      {selections.map((selection) => (
        <button
          key={selection.selection_id}
          type="button"
          className="agent-composer-mcp-chip"
          onClick={() => onRemove(selection.selection_id)}
          title="Remove MCP selection"
        >
          <span className="agent-composer-mcp-chip__kind">{selection.kind}</span>
          <span className="agent-composer-mcp-chip__label">{selectionSummaryLabel(selection)}</span>
          <span className="agent-composer-mcp-chip__remove">x</span>
        </button>
      ))}
    </div>
  );
});

const AgentInputForm: React.FC<AgentInputFormProps> = React.memo(({
  projectId,
  hasSelectedAgent,
  isMessageRunActive,
  isSendBlocked,
  sendBlockedReason,
  pendingAttachments,
  selectedMcpSelections,
  fileInputRef,
  onPrepareMcpMenu,
  onOpenAttachmentPicker,
  onFileInputChange,
  onRemoveAttachment,
  onRemoveMcpSelection,
  onSelectMcpPrompt,
  onSelectMcpResource,
  availableMcpServers,
  onSubmit,
  onStop,
}) => {
  const { t } = useTranslation();
  const input = useUiStore((state) => state.inputByProject[projectId] ?? '');
  const setInput = useUiStore((state) => state.setInput);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    if (isMessageRunActive || isSendBlocked || !hasSelectedAgent) {
      e.preventDefault();
      return;
    }
    void onSubmit(e, input);
  }, [isMessageRunActive, isSendBlocked, hasSelectedAgent, onSubmit, input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (isMessageRunActive || isSendBlocked || !hasSelectedAgent) return;
    void onSubmit(e as unknown as React.FormEvent, input);
  }, [isMessageRunActive, isSendBlocked, hasSelectedAgent, onSubmit, input]);

  return (
    <form onSubmit={handleSubmit} className="agent-form">
      {!isMessageRunActive && isSendBlocked && sendBlockedReason && (
        <div className="agent-send-blocker-hint" role="status">
          {sendBlockedReason}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={CHAT_ATTACHMENT_ACCEPT}
        multiple
        className="agent-attachment-input"
        onChange={onFileInputChange}
      />
      <div className="input-group">
        <div className="agent-composer-shell">
          {pendingAttachments.length > 0 && (
            <div className="agent-composer-attachments" aria-label={t('agent.addFiles')}>
              {pendingAttachments.map((attachment) => (
                <PendingAttachmentCard
                  key={attachment.clientId}
                  attachment={attachment}
                  onRemove={onRemoveAttachment}
                />
              ))}
            </div>
          )}

          <ComposerMcpChipRow selections={selectedMcpSelections} onRemove={onRemoveMcpSelection} />

          <div className="agent-input-row">
            <DropdownMenu
              align="left"
              onOpenChange={(isOpen) => {
                if (isOpen) onPrepareMcpMenu();
              }}
              trigger={(
                <IconButton
                  icon={<Plus size="sm" />}
                  variant="ghost"
                  size="sm"
                  title={t('agent.addFiles')}
                  className="agent-attachment-menu-trigger"
                />
              )}
            >
              <DropdownItem
                icon={<Upload size="sm" />}
                label={t('agent.addFiles')}
                onClick={onOpenAttachmentPicker}
                disabled={pendingAttachments.length >= CHAT_ATTACHMENT_MAX_FILES}
              />
              {availableMcpServers.some((server) => server.snapshot.catalog.prompts.length > 0) && (
                <div className="dropdown-section-label">MCP Prompts</div>
              )}
              {availableMcpServers.flatMap((server) => (
                server.snapshot.catalog.prompts.map((prompt) => (
                  <DropdownItem
                    key={`prompt:${server.id}:${prompt.name}`}
                    icon={<Document size="sm" />}
                    label={`${server.display_name}: ${prompt.title || prompt.name}`}
                    onClick={() => onSelectMcpPrompt(server, prompt)}
                  />
                ))
              ))}
              {availableMcpServers.some((server) => server.snapshot.catalog.resources.length > 0) && (
                <div className="dropdown-section-label">MCP Resources</div>
              )}
              {availableMcpServers.flatMap((server) => (
                server.snapshot.catalog.resources.map((resource) => (
                  <DropdownItem
                    key={`resource:${server.id}:${resource.uri}`}
                    icon={<Document size="sm" />}
                    label={`${server.display_name}: ${resource.title || resource.name || resource.uri}`}
                    onClick={() => onSelectMcpResource(server, resource)}
                  />
                ))
              ))}
            </DropdownMenu>

            <textarea
              value={input}
              onChange={(e) => setInput(projectId, e.target.value)}
              placeholder={t('agent.enterMessage')}
              rows={1}
              className="agent-input"
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>

        {isMessageRunActive ? (
          <IconButton
            key="stop"
            icon={<Stop size="md" />}
            onClick={onStop}
            variant="danger"
            title={t('agent.stop')}
            className="agent-submit-btn"
          />
        ) : (
          <IconButton
            key="send"
            type="submit"
            icon={<Send size="md" />}
            variant="primary"
            title={t('agent.send')}
            className="agent-submit-btn"
            disabled={isSendBlocked || !hasSelectedAgent}
          />
        )}
      </div>
    </form>
  );
});

export const AgentPanel: React.FC<AgentPanelProps> = ({ projectId, surface, displayLanguage }) => {
  const { t } = useTranslation();
  const settings = useSettings();
  const sidebarStore = useUiStore();
  const contextDisplayLanguage = displayLanguage || settings.mainLanguage;

  const selectedAgentId = useSelectionStore((state) => state.selectedAgentByProject[projectId]);
  const selectedAgent = useSelectedAgent(projectId);
  const activePresetId = useActivePresetId();
  const mcpServers = useMcpServers(activePresetId);
  const syncMcpServer = useSyncMcpServerMutation(activePresetId ?? '');
  // Keep sub-agents warm while the agent panel is mounted (replaces the old
  // imperative subAgentStore.ensureLoaded()).
  useSubAgentsQuery(activePresetId);
  const markAgentViewed = useUiStore((state) => state.markAgentViewed);
  const setAgentVisible = useUiStore((state) => state.setAgentVisible);
  const agentVisibleState = useUiStore((state) => state.agentVisibleByProject[projectId] ?? false);
  const preflightToast = useUiStore((state) => state.preflightToastByProject[projectId] ?? null);
  const runMode = useUiStore((state) => state.runModeByProject[projectId] ?? 'agentMode');
  const setRunMode = useUiStore((state) => state.setRunMode);
  const setInput = useUiStore((state) => state.setInput);
  const {
    objects: unifiedObjects,
    isLoading: isContextObjectsLoading,
  } = useProjectObjectsMapState(projectId, contextDisplayLanguage);
  const selectedChapterId = useEditorStore((state) => state.selectedChapterByProject[projectId]);

  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth > 768
  ));
  const [isOverlayClosing, setIsOverlayClosing] = useState(false);
  const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
  const [isContextPickerLoading, setIsContextPickerLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [selectedMcpSelections, setSelectedMcpSelections] = useState<McpSelection[]>([]);
  const [pendingPromptSelection, setPendingPromptSelection] = useState<PendingPromptSelection | null>(null);
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);

  const contextDropdownRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputOverlayRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  const threadId = selectedAgent?.thread_id ?? null;
  const isAgentVisible = isDesktop ? true : agentVisibleState;

  const {
    thread,
    messages,
    toolCallsByMessageId,
  } = useThreadView(threadId);
  const liveView = useThreadLiveViewState(threadId);

  const availableMcpServers = useMemo(() => (
    mcpServers.filter((server) => (
      server.enabled && (runMode === 'planMode' ? server.allow_plan_mode : server.allow_agent_mode)
    ))
  ), [mcpServers, runMode]);

  const availableContextIds = useMemo(
    () => getAllModeSelectableIds(Object.values(unifiedObjects)),
    [unifiedObjects],
  );
  const {
    selectedIds: selectedContextIds,
    setSelectedIds: setSelectedContextIds,
  } = useSharedObjectPickerSelection({
    projectId,
    bucket: 'all-context',
    availableIds: availableContextIds,
  });
  const totalObjectCount = availableContextIds.length;

  const focusedManuscriptId = useMemo(() => {
    if (surface !== 'novel-editor') return null;
    const chapterId = selectedChapterId || localStorage.getItem(`selectedChapter_${projectId}`) || null;
    if (!chapterId) return null;

    const chapterObject = unifiedObjects[chapterId];
    const linkedId = chapterObject?.metadata?.manuscript_id;
    if (typeof linkedId === 'string' && linkedId.trim()) {
      return linkedId;
    }

    const manuscript = Object.values(unifiedObjects).find(
      (obj) => obj.type === 'manuscript' && obj.metadata?.chapter_id === chapterId,
    );
    return manuscript?.id ?? null;
  }, [projectId, selectedChapterId, surface, unifiedObjects]);

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a.seqInThread - b.seqInThread),
    [messages],
  );

  const runtimeUnresolvedToolCallCount = Number(thread?.unresolvedToolCallCount ?? 0);

  const isMessageRunActive = useMemo(() => (
    thread?.status === 'running'
    || thread?.status === 'processing'
    || liveView?.noticeKind === 'preexisting_live_run'
  ), [thread?.status, liveView?.noticeKind]);

  const sendBlockingState: SendBlockingState = useMemo(() => {
    const missingAgent = !selectedAgentId;
    const unresolvedToolCalls = summarizeToolCallBlocking(
      orderedMessages.map((message) => message.id),
      toolCallsByMessageId,
      thread?.latestRunId ?? null,
      runtimeUnresolvedToolCallCount,
    );
    const running = isMessageRunActive;

    let reason: SendBlockReason = null;
    if (missingAgent) {
      reason = 'missing_agent';
    } else if (unresolvedToolCalls.count > 0) {
      reason = 'pending_tool_calls';
    } else if (running) {
      reason = 'running';
    } else if (isContextObjectsLoading) {
      reason = 'context_loading';
    }

    return {
      blocked: missingAgent || running || unresolvedToolCalls.count > 0 || isContextObjectsLoading,
      reason,
      unresolvedToolCalls,
    };
  }, [
    selectedAgentId,
    orderedMessages,
    toolCallsByMessageId,
    isMessageRunActive,
    isContextObjectsLoading,
    thread?.latestRunId,
    runtimeUnresolvedToolCallCount,
  ]);

  const sendBlockedReason = useMemo(() => {
    if (!sendBlockingState.blocked || !sendBlockingState.reason) return null;
    if (sendBlockingState.reason === 'missing_agent') {
      return 'Select an agent before sending a message.';
    }
    if (sendBlockingState.reason === 'pending_tool_calls') {
      return `Resolve ${sendBlockingState.unresolvedToolCalls.count} pending operation(s) before sending.`;
    }
    if (sendBlockingState.reason === 'running') {
      return 'The agent is still generating a response.';
    }
    if (sendBlockingState.reason === 'context_loading') {
      return 'Project context is still loading.';
    }
    return 'Resolve pending operations before sending.';
  }, [sendBlockingState]);

  useEffect(() => {
    if (!projectId || !selectedAgentId) return;
    markAgentViewed(projectId, selectedAgentId);
  }, [projectId, selectedAgentId, markAgentViewed]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  const clearPendingAttachments = useCallback((options?: { revoke?: boolean }) => {
    const shouldRevoke = options?.revoke !== false;
    setPendingAttachments((prev) => {
      if (shouldRevoke) {
        prev.forEach((attachment) => revokeAttachmentPreview(attachment));
      }
      return [];
    });
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, []);

  useEffect(() => () => {
    pendingAttachmentsRef.current.forEach((attachment) => revokeAttachmentPreview(attachment));
  }, []);

  useEffect(() => {
    clearPendingAttachments();
    setSelectedMcpSelections([]);
    setPendingPromptSelection(null);
  }, [selectedAgentId, threadId, clearPendingAttachments]);

  const prepareMcpMenu = useCallback(() => {
    if (!activePresetId) return;
    const now = Date.now();
    availableMcpServers.forEach((server) => {
      if (!server.snapshot.synced_at) {
        void syncMcpServer.mutateAsync(server.id).catch(() => {});
        return;
      }
      const ageMs = now - new Date(server.snapshot.synced_at).getTime();
      if (ageMs > 10 * 60 * 1000) {
        void syncMcpServer.mutateAsync(server.id).catch(() => {});
      }
    });
  }, [activePresetId, availableMcpServers, syncMcpServer]);

  const appendMcpSelection = useCallback((selection: McpSelection) => {
    setSelectedMcpSelections((prev) => [...prev, selection]);
  }, []);

  const removeMcpSelection = useCallback((selectionId: string) => {
    setSelectedMcpSelections((prev) => prev.filter((item) => item.selection_id !== selectionId));
  }, []);

  const handleSelectMcpPrompt = useCallback((server: McpServerResponse, prompt: McpCatalogPrompt) => {
    const values: Record<string, string> = {};
    for (const arg of prompt.arguments) {
      values[arg.name] = '';
    }
    if (prompt.arguments.length > 0) {
      setPendingPromptSelection({ server, prompt, values });
      return;
    }
    appendMcpSelection({
      selection_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `mcp-${Date.now()}`,
      server_id: server.id,
      kind: 'prompt',
      prompt_name: prompt.name,
      arguments: {},
    });
  }, [appendMcpSelection]);

  const handleSelectMcpResource = useCallback((server: McpServerResponse, resource: McpCatalogResource) => {
    appendMcpSelection({
      selection_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `mcp-${Date.now()}`,
      server_id: server.id,
      kind: 'resource',
      resource_uri: resource.uri,
    });
  }, [appendMcpSelection]);

  useEffect(() => {
    if (!isContextDropdownOpen || !projectId) {
      setIsContextPickerLoading(false);
      return;
    }

    let cancelled = false;
    setIsContextPickerLoading(true);

    void ensureTimelineLoaded(projectId, contextDisplayLanguage)
      .catch((loadError) => {
        console.error('Failed to preload agent timeline context:', loadError);
      })
      .finally(() => {
        if (!cancelled) {
          setIsContextPickerLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isContextDropdownOpen, projectId, contextDisplayLanguage]);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const container = inputOverlayRef.current;
    if (!container) return;

    const apply = () => {
      setComposerOverlayHeight(container.offsetHeight);
    };

    apply();

    const ro = new ResizeObserver(() => apply());
    ro.observe(container);

    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isContextDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!contextDropdownRef.current?.contains(event.target as Node)) {
        setIsContextDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsContextDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isContextDropdownOpen]);

  const handleSubmit = useCallback(async (e: React.FormEvent, inputText: string) => {
    e.preventDefault();
    if (!threadId) return;

    const success = await sendThreadMessage({
      threadId,
      projectId,
      threadType: 'agent',
      inputText,
      request: {
        run_mode: runMode,
        surface,
        context_object_ids: computeParentClosure(selectedContextIds, unifiedObjects),
        input_payload: focusedManuscriptId
          ? { agent_focus: { manuscript_id: focusedManuscriptId } }
          : undefined,
        attachments: pendingAttachments,
        mcp_selections: selectedMcpSelections,
      },
    });
    if (success) {
      setInput(projectId, '');
      clearPendingAttachments();
      setSelectedMcpSelections([]);
    }
  }, [
    threadId,
    projectId,
    runMode,
    surface,
    selectedContextIds,
    unifiedObjects,
    focusedManuscriptId,
    pendingAttachments,
    selectedMcpSelections,
    setInput,
    clearPendingAttachments,
  ]);

  const handlePromptDialogValueChange = useCallback((name: string, value: string) => {
    setPendingPromptSelection((current) => {
      if (!current) return current;
      return {
        ...current,
        values: {
          ...current.values,
          [name]: value,
        },
      };
    });
  }, []);

  const handleConfirmPromptSelection = useCallback(() => {
    if (!pendingPromptSelection) return;
    const argumentsPayload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pendingPromptSelection.values)) {
      if (value.trim()) {
        argumentsPayload[key] = value;
      }
    }
    appendMcpSelection({
      selection_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `mcp-${Date.now()}`,
      server_id: pendingPromptSelection.server.id,
      kind: 'prompt',
      prompt_name: pendingPromptSelection.prompt.name,
      arguments: argumentsPayload,
    });
    setPendingPromptSelection(null);
  }, [appendMcpSelection, pendingPromptSelection]);

  const handleSubmitFromInput = useCallback(async (e: React.FormEvent, inputText: string) => {
    if (isMessageRunActive) {
      e.preventDefault();
      return;
    }
    if (sendBlockingState.blocked) {
      e.preventDefault();
      if (sendBlockedReason) {
        showAlert({ title: 'Cannot Send', message: sendBlockedReason });
      }
      return;
    }
    await handleSubmit(e, inputText);
  }, [
    isMessageRunActive,
    sendBlockingState.blocked,
    sendBlockedReason,
    handleSubmit,
  ]);

  const handleStop = useCallback(() => {
    if (!threadId) return;
    void cancelThread({ threadId }).catch((error) => {
      console.error('Failed to cancel run:', error);
    });
  }, [threadId]);

  const handleOpenAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((prev) => {
      const next: PendingAttachment[] = [];
      for (const attachment of prev) {
        if (attachment.clientId === attachmentId) {
          revokeAttachmentPreview(attachment);
          continue;
        }
        next.push(attachment);
      }
      return next;
    });
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, []);

  const handleAttachmentInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    if (pendingAttachments.length + files.length > CHAT_ATTACHMENT_MAX_FILES) {
      showAlert({
        title: t('agent.addFiles'),
        message: t('agent.tooManyAttachments', { count: CHAT_ATTACHMENT_MAX_FILES }),
      });
      event.target.value = '';
      return;
    }

    const existingTotalBytes = pendingAttachments.reduce((sum, attachment) => sum + attachment.size, 0);
    let nextTotalBytes = existingTotalBytes;
    const nextAttachments: PendingAttachment[] = [];

    for (const file of files) {
      const mimeType = (file.type || '').toLowerCase();
      if (!isSupportedAttachmentMimeType(mimeType, file.name)) {
        showAlert({
          title: t('agent.addFiles'),
          message: t('agent.unsupportedAttachmentType', { filename: file.name || 'file' }),
        });
        continue;
      }

      if (file.size > CHAT_ATTACHMENT_MAX_FILE_BYTES) {
        showAlert({
          title: t('agent.addFiles'),
          message: t('agent.attachmentTooLarge', {
            filename: file.name || 'file',
            size: formatAttachmentSize(CHAT_ATTACHMENT_MAX_FILE_BYTES),
          }),
        });
        continue;
      }

      nextTotalBytes += file.size;
      if (nextTotalBytes > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
        nextAttachments.forEach((attachment) => revokeAttachmentPreview(attachment));
        showAlert({
          title: t('agent.addFiles'),
          message: t('agent.attachmentTotalTooLarge', {
            size: formatAttachmentSize(CHAT_ATTACHMENT_MAX_TOTAL_BYTES),
          }),
        });
        event.target.value = '';
        return;
      }

      nextAttachments.push(createPendingAttachment(file));
    }

    if (nextAttachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...nextAttachments]);
    }
    event.target.value = '';
  }, [pendingAttachments, t]);

  const handleCloseAgent = useCallback(() => {
    setIsOverlayClosing(true);
    setAgentVisible(projectId, false);
  }, [projectId, setAgentVisible]);

  const handleOverlayAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.animationName === 'overlayFadeOut') {
      setIsOverlayClosing(false);
      setAgentVisible(projectId, false);
    }
  }, [projectId, setAgentVisible]);

  const handleSelectAgentFromSidebar = useCallback(() => {
    useUiStore.getState().closeSidebar(projectId);
  }, [projectId]);

  const panelContent = (
    <div className={`agent-panel ${isAgentVisible ? 'visible' : 'hidden'}`} ref={panelRef}>
      <div className="agent-header">
        <div className="agent-header-left">
          <TextButton
            variant="secondary"
            size="sm"
            onClick={() => sidebarStore.toggleSidebar(projectId, 'agent')}
            title={t('agent.viewAgentList')}
          >
            {t('agent.agents')}
          </TextButton>
          <h2>{selectedAgent?.name || t('agent.aiAgent')}</h2>
        </div>
        <TextButton
          variant="secondary"
          size="sm"
          className="mobile-only"
          onClick={() => setAgentVisible(projectId, false)}
        >
          {t('agent.close')}
        </TextButton>
      </div>

      <div className="agent-panel-thread-pane">
        <ThreadMessageList
          threadId={threadId ?? ''}
          projectId={projectId}
          roleLabels={{ user: t('agent.you'), assistant: t('agent.ai') }}
          emptyState={t('agent.welcomeMessage')}
          bottomOverlayHeight={composerOverlayHeight}
        />

        <div className="agent-input-wrap" ref={inputOverlayRef}>
          <div
            className="agent-input-container"
            ref={(el) => {
              contextDropdownRef.current = el;
            }}
          >
            {preflightToast && (
              <div
                className={`agent-preflight-toast ${preflightToast.type === 'error' ? 'agent-preflight-toast--error' : ''}`}
                role={preflightToast.type === 'error' ? 'alert' : 'status'}
              >
                {preflightToast.message}
              </div>
            )}

            <div className={`agent-context-dropdown-menu ${isContextDropdownOpen ? '' : 'hidden'}`}>
              {isContextDropdownOpen && (
                <ObjectPicker
                  mode="all"
                  selectionMode="multi"
                  selectedIds={selectedContextIds}
                  onChange={(ids) => setSelectedContextIds(Array.isArray(ids) ? ids : [ids])}
                  projectId={projectId}
                  language={settings.mainLanguage}
                  loading={isContextPickerLoading}
                  maxHeight="var(--size-content-sm)"
                  showSearch={true}
                  showSelectAll={true}
                  showTokenCount={true}
                />
              )}
            </div>

            <div className="agent-controls-row">
              <AgentRunModeToggle
                currentRunMode={runMode as AgentRunMode}
                onRunModeChange={(next) => setRunMode(projectId, next)}
              />
              <AgentContextTrigger
                selectedCount={selectedContextIds.length}
                totalCount={totalObjectCount}
                isOpen={isContextDropdownOpen}
                onClick={() => setIsContextDropdownOpen((prev) => !prev)}
              />
            </div>

            <AgentInputForm
              projectId={projectId}
              hasSelectedAgent={Boolean(selectedAgentId && threadId)}
              isMessageRunActive={isMessageRunActive}
              isSendBlocked={sendBlockingState.blocked}
              sendBlockedReason={sendBlockedReason}
              pendingAttachments={pendingAttachments}
              selectedMcpSelections={selectedMcpSelections}
              fileInputRef={attachmentInputRef}
              onPrepareMcpMenu={prepareMcpMenu}
              onOpenAttachmentPicker={handleOpenAttachmentPicker}
              onFileInputChange={handleAttachmentInputChange}
              onRemoveAttachment={handleRemoveAttachment}
              onRemoveMcpSelection={removeMcpSelection}
              onSelectMcpPrompt={handleSelectMcpPrompt}
              onSelectMcpResource={handleSelectMcpResource}
              availableMcpServers={availableMcpServers}
              onSubmit={handleSubmitFromInput}
              onStop={handleStop}
            />
          </div>
        </div>
      </div>

      <BaseModal
        isOpen={Boolean(pendingPromptSelection)}
        onClose={() => setPendingPromptSelection(null)}
        title={pendingPromptSelection ? `MCP Prompt: ${pendingPromptSelection.prompt.title || pendingPromptSelection.prompt.name}` : 'MCP Prompt'}
        size="small"
        footer={(
          <>
            <TextButton variant="secondary" onClick={() => setPendingPromptSelection(null)}>
              Cancel
            </TextButton>
            <TextButton variant="primary" onClick={handleConfirmPromptSelection}>
              Add
            </TextButton>
          </>
        )}
      >
        <div className="agent-mcp-prompt-modal">
          {pendingPromptSelection?.prompt.arguments.map((arg) => (
            <label key={arg.name} className="agent-mcp-prompt-modal__field">
              <span>{arg.name}{arg.required ? ' *' : ''}</span>
              <input
                value={pendingPromptSelection.values[arg.name] ?? ''}
                onChange={(event) => handlePromptDialogValueChange(arg.name, event.target.value)}
                placeholder={arg.description || arg.name}
              />
            </label>
          ))}
        </div>
      </BaseModal>

      <AgentSidebar
        projectId={projectId}
        onSelectAgent={handleSelectAgentFromSidebar}
      />

      {(isAgentVisible || isOverlayClosing) && createPortal(
        <div
          className={`agent-overlay mobile-only ${isOverlayClosing ? 'closing' : ''}`}
          onClick={handleCloseAgent}
          onAnimationEnd={handleOverlayAnimationEnd}
        />,
        document.getElementById('root') || document.body,
      )}
    </div>
  );

  return !isDesktop ? createPortal(panelContent, document.body) : panelContent;
};

export default AgentPanel;
