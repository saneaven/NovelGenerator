import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '../../../store/agentStore';
import { useAgentUIStore } from '../../../store/agentUIStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettings } from '../../../store/settingsStore';
import { usePresetStore } from '../../../store/presetStore';
import { useMcpStore } from '../../../store/mcpStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { useThreadStore } from '../../../store/threadStore';
import { threadService } from '../../../api/threadService';
import { runMessageTranslation } from '../../../agent/messageTranslation';
import { isUuid } from '../../../utils/idUtils';
import { computeParentClosure } from '../../../utils/parentClosure';
import {
  cancelThread,
  sendThreadMessage,
} from '../../../runtime/threadCommands';
import { useToolCallDecisions } from '../../../toolCall/useToolCallDecisions';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import AgentSidebar from '../../../components/Agent/AgentSidebar';
import { DefaultDisplayProcessor } from '../../../agent/processors/DisplayProcessor';
import type { AgentRunMode } from '../../../types/agentRuntime';
import type { ChatMessage, ToolCallMetadata } from '../../../types/chat';
import { resolveRunMessageDisplay, type ThreadMessage, type ThreadToolCall } from '../../../types/thread';
import ThinkingDisplay from '../../../components/common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../../../components/common/PreexistingLiveRunNotice';
import { FunctionCallsThread } from '../../../toolCall/ui';
import { SubAgentPeekDock } from '../../../components/SubAgentPeek';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import AuthenticatedImage from '../../../components/common/AuthenticatedImage';
import AgentRunModeToggle from '../../../components/ui/AgentRunModeToggle';
import { DropdownItem, DropdownMenu } from '../../../components/ui/DropdownMenu';
import { BaseModal } from '../../../components/BaseModal';
import { buildEditCardsFromToolCallMetadata } from '../../../toolCall';
import {
  Settings,
  Edit,
  Trash,
  Globe,
  CircularArrow,
  ChevronDown,
  Send,
  Stop,
  Plus,
  Upload,
  Document,
  Image as ImageIcon,
  Close,
} from '../../../components/icons';
import '../../../pages/workspace/styles/AgentPanel.css';
import '../../../pages/workspace/styles/AgentHeader.css';
import '../../../pages/workspace/styles/AgentMessages.css';
import '../../../pages/workspace/styles/MessageEdit.css';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import '../../../pages/workspace/styles/AgentInput.css';
import { useThreadLiveViewState } from '../../../hooks/useThreadLiveViewState';
import { useAutoScrollLock } from '../../../hooks/useAutoScrollLock';
import { hasRenderableAssistantOutput } from '../../../runtime/messageVisibility';
import { fetchAndReplaceThreadSnapshot } from '../../../runtime/threadHydration';
import { applyOptimisticDeletePause, getThreadDeletePauseContext } from '../../../runtime/threadDeleteState';
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
import type { McpCatalogPrompt, McpCatalogResource, McpSelection, McpSelectionAudit, McpServerResponse } from '../../../types/mcp';

const EMPTY_MESSAGES: ThreadMessage[] = [];

interface AgentPanelProps {
  projectId: string;
  surface?: string;
  displayLanguage: string;
}

interface DisplayMessageInfo {
  source: ThreadMessage;
  chatMessage: ChatMessage;
  requestedLanguage: string;
  displayLanguage: string;
}

interface ToolCallBlockingSummary {
  count: number;
  firstMessageId?: string;
}

type DisplayItem =
  | { kind: 'user_message'; info: DisplayMessageInfo }
  | {
      kind: 'assistant_block';
      info: DisplayMessageInfo;
      toolCalls: ThreadToolCall[];
      toolCallMessageIds: string[];
    };

type SendBlockReason = 'missing_agent' | 'running' | 'pending_tool_calls' | null;

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

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.id,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    extra_content: toolCall.extraContent ?? undefined,
    status: toolCall.status as any,
    reason: toolCall.reason ?? undefined,
    imageRunId: toolCall.imageRunId ?? undefined,
    failureType: toolCall.status === 'failed'
      ? (toolCall.reason?.startsWith('VALIDATION::') ? 'validation' : 'execution')
      : undefined,
    result: (toolCall.result ?? undefined) as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function collapseContent(parts: Array<{ type: string; text: string }>): string {
  return parts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('')
    .trim();
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
          attachment.kind === 'image' ? <ImageIcon size="md" /> : <Document size="md" />
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

function getMessageMcpSelections(message: ThreadMessage): McpSelectionAudit[] {
  for (const entry of Object.values(message.data)) {
    const selections = entry.meta?.mcpSelections;
    if (Array.isArray(selections) && selections.length > 0) {
      return selections;
    }
  }
  return [];
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

const MessageMcpChipRow: React.FC<{
  selections: McpSelectionAudit[];
}> = React.memo(({ selections }) => {
  if (selections.length === 0) return null;
  return (
    <div className="agent-message-mcp-chips">
      {selections.map((selection) => (
        <div key={selection.selection_id} className="agent-message-mcp-chip">
          <span className="agent-message-mcp-chip__kind">{selection.kind}</span>
          <span className="agent-message-mcp-chip__label">{selection.summary_label}</span>
        </div>
      ))}
    </div>
  );
});

const MessageAttachmentBlock: React.FC<{
  attachments: ThreadMessage['attachments'];
}> = React.memo(({ attachments }) => {
  const sortedAttachments = [...attachments].sort((a, b) => a.sortOrder - b.sortOrder);
  const imageAttachments = sortedAttachments.filter((attachment) => attachment.kind === 'image');
  const documentAttachments = sortedAttachments.filter((attachment) => attachment.kind === 'document');

  if (sortedAttachments.length === 0) {
    return null;
  }

  return (
    <div className="message-attachments">
      {imageAttachments.length > 0 && (
        <div className={`message-attachments-grid ${imageAttachments.length === 1 ? 'single' : ''}`}>
          {imageAttachments.map((attachment) => (
            <div key={attachment.id} className="message-attachment-image-card">
              <AuthenticatedImage
                src={attachment.url}
                alt={attachment.originalFilename}
                className="message-attachment-image"
              />
            </div>
          ))}
        </div>
      )}

      {documentAttachments.length > 0 && (
        <div className="message-attachments-documents">
          {documentAttachments.map((attachment) => (
            <div key={attachment.id} className="message-attachment-document-card">
              <div className="message-attachment-document-icon" aria-hidden="true">
                <Document size="md" />
              </div>
              <div className="message-attachment-document-meta">
                <div
                  className="message-attachment-document-name"
                  title={attachment.originalFilename}
                >
                  {attachment.originalFilename}
                </div>
                <div className="message-attachment-document-size">
                  {formatAttachmentSize(attachment.fileSize)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
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
  const input = useAgentUIStore((state) => state.inputByProject[projectId] ?? '');
  const setInput = useAgentUIStore((state) => state.setInput);

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
  const sidebarStore = useSidebarStore();
  const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
  const sourceLanguage = settings.mainLanguage;
  const secondaryDisplayLanguage = displayLanguage !== settings.mainLanguage
    ? displayLanguage
    : (settings.defaultSubLanguage ?? undefined);

  const selectedAgentId = useAgentStore((state) => state.selectedAgentByProject[projectId]);
  const selectedAgent = useAgentStore((state) => state.getSelectedAgent(projectId));
  const activePresetId = usePresetStore((state) => state.activePresetId);
  const { mcpServers, ensureMcpLoaded, syncMcpServer } = useMcpStore(useShallow((state) => ({
    mcpServers: state.servers,
    ensureMcpLoaded: state.ensureLoaded,
    syncMcpServer: state.syncServer,
  })));
  const markAgentViewed = useAgentUIStore((state) => state.markAgentViewed);
  const setAgentVisible = useAgentUIStore((state) => state.setAgentVisible);
  const agentVisibleState = useAgentUIStore((state) => state.agentVisibleByProject[projectId] ?? false);
  const preflightToast = useAgentUIStore((state) => state.preflightToastByProject[projectId] ?? null);
  const runMode = useAgentUIStore((state) => state.runModeByProject[projectId] ?? 'agentMode');
  const setRunMode = useAgentUIStore((state) => state.setRunMode);
  const setInput = useAgentUIStore((state) => state.setInput);
  const unifiedObjects = useUnifiedObjectStore((state) => state.objects);
  const refreshProjectObjects = useUnifiedObjectStore((state) => state.refreshProjectObjects);
  const selectedChapterId = useNovelEditorStore((state) => state.selectedChapterByProject[projectId]);

  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth > 768
  ));
  const [isOverlayClosing, setIsOverlayClosing] = useState(false);
  const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
  const [isContextPickerLoading, setIsContextPickerLoading] = useState(false);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [messageLanguageView, setMessageLanguageView] = useState<Record<string, 'primary' | 'secondary'>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingSaving, setEditingSaving] = useState(false);
  const [translatingByMessageId, setTranslatingByMessageId] = useState<Record<string, boolean>>({});
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [selectedMcpSelections, setSelectedMcpSelections] = useState<McpSelection[]>([]);
  const [pendingPromptSelection, setPendingPromptSelection] = useState<PendingPromptSelection | null>(null);

  const contextDropdownRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const hydratedThreadIdsRef = useRef<Set<string>>(new Set());
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  const threadId = selectedAgent?.thread_id ?? null;
  const isAgentVisible = isDesktop ? true : agentVisibleState;

  const {
    thread,
    messages,
    toolCallsByMessageId,
    toolCallsById,
    toolCallIdsByAssistantMessageId,
  } = useThreadStore(
    useShallow((state) => ({
      thread: threadId ? state.threadsById[threadId] : undefined,
      messages: threadId ? state.messagesByThreadId[threadId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
      toolCallsByMessageId: state.toolCallsByMessageId,
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
    })),
  );
  const liveView = useThreadLiveViewState(threadId);

  const availableMcpServers = useMemo(() => (
    mcpServers.filter((server) => (
      server.enabled && (runMode === 'planMode' ? server.allow_plan_mode : server.allow_agent_mode)
    ))
  ), [mcpServers, runMode]);

  const totalObjectCount = useMemo(() => (
    Object.values(unifiedObjects).filter((obj) => (
      obj.metadata?.project_id === projectId
      && obj.type !== 'basic_info'
      && obj.type !== 'guidelines'
      && !(obj.type === 'outline' && obj.metadata?.kind !== 'chapter')
    )).length
  ), [unifiedObjects, projectId]);

  const contextIdSet = useMemo(() => (
    new Set(
      Object.values(unifiedObjects)
        .filter((obj) => (
          obj.metadata?.project_id === projectId
          && obj.type !== 'basic_info'
          && obj.type !== 'guidelines'
        ))
        .map((obj) => obj.id),
    )
  ), [unifiedObjects, projectId]);

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

  const displayItems = useMemo(() => {
    const items: DisplayItem[] = [];
    let i = 0;

    while (i < orderedMessages.length) {
      const msg = orderedMessages[i];

      if (msg.role === 'tool_call') {
        i++;
        continue;
      }

      const wantsSecondary = messageLanguageView[msg.id] === 'secondary' && Boolean(secondaryDisplayLanguage);
      const requestedLanguage = wantsSecondary && secondaryDisplayLanguage ? secondaryDisplayLanguage : sourceLanguage;
      const fallbackLanguage = wantsSecondary ? sourceLanguage : secondaryDisplayLanguage;
      const assistantIndexedToolCalls = msg.role === 'assistant'
        ? (toolCallIdsByAssistantMessageId[msg.id] ?? [])
          .map((id) => toolCallsById[id])
          .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall))
          .filter((toolCall) => toolCall.toolName.trim().length > 0)
        : [];

      let j = i + 1;
      const toolCallMessageIds: string[] = [];
      if (msg.role === 'assistant') {
        while (j < orderedMessages.length && orderedMessages[j].role === 'tool_call') {
          const nextToolCalls = toolCallsByMessageId[orderedMessages[j].id] ?? [];
          const nextAssistantId = nextToolCalls[0]?.assistantMessageId ?? null;
          if (nextAssistantId !== msg.id) break;
          toolCallMessageIds.push(orderedMessages[j].id);
          j++;
        }
      }

      const messageScopedToolCalls = msg.role === 'assistant'
        ? toolCallMessageIds
          .flatMap((messageId) => toolCallsByMessageId[messageId] ?? [])
          .filter((toolCall) => toolCall.toolName.trim().length > 0)
        : [];

      const attachedToolCalls = msg.role === 'assistant'
        ? (() => {
            const seen = new Set<string>();
            const merged: ThreadToolCall[] = [];
            for (const toolCall of [...messageScopedToolCalls, ...assistantIndexedToolCalls]) {
              if (seen.has(toolCall.id)) continue;
              seen.add(toolCall.id);
              merged.push(toolCall);
            }
            return merged;
          })()
        : [];

      if (msg.role === 'assistant') {
        for (const toolCall of attachedToolCalls) {
          if (!toolCall.messageId) continue;
          if (toolCallMessageIds.includes(toolCall.messageId)) continue;
          toolCallMessageIds.push(toolCall.messageId);
        }
      }

      if (msg.role === 'assistant' && !hasRenderableAssistantOutput({
        message: msg,
        language: requestedLanguage,
        fallbackLanguage: fallbackLanguage ?? undefined,
        toolCalls: attachedToolCalls,
      })) {
        i = j;
        continue;
      }

      const resolved = msg.isStreaming
        ? {
            contentParts: msg.streamingData?.contentParts ?? [],
            reasoningDetail: msg.streamingData?.reasoningDetail,
            displayLanguage: requestedLanguage,
            isFallback: false,
          }
        : resolveRunMessageDisplay(msg, requestedLanguage, fallbackLanguage);

      const chatMessage: ChatMessage = {
        id: msg.id,
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        contentParts: resolved.contentParts as any,
        reasoning_detail: (resolved.reasoningDetail as any),
        timestamp: new Date(msg.createdAt),
      };

      const info: DisplayMessageInfo = {
        source: msg,
        chatMessage,
        requestedLanguage,
        displayLanguage: resolved.displayLanguage,
      };

      if (msg.role === 'assistant') {
        items.push({
          kind: 'assistant_block',
          info,
          toolCalls: attachedToolCalls,
          toolCallMessageIds,
        });
        i = j;
        continue;
      }

      items.push({
        kind: 'user_message',
        info,
      });
      i++;
    }

    return items;
  }, [
    orderedMessages,
    toolCallsById,
    toolCallIdsByAssistantMessageId,
    toolCallsByMessageId,
    messageLanguageView,
    sourceLanguage,
    secondaryDisplayLanguage,
  ]);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = orderedMessages.length - 1; i >= 0; i--) {
      const msg = orderedMessages[i];
      if (msg.role === 'assistant' && !msg.isStreaming) {
        return msg.id;
      }
    }
    return null;
  }, [orderedMessages]);

  const hasStreamingMessage = liveView?.hasStreamingMessage ?? false;
  const runtimeUnresolvedToolCallCount = Number(thread?.unresolvedToolCallCount ?? 0);

  const isMessageRunActive = useMemo(() => (
    thread?.status === 'running'
    || liveView?.noticeKind === 'preexisting_live_run'
  ), [thread?.status, liveView?.noticeKind]);

  const {
    showScrollButton,
    scrollToBottom,
    resetToBottom,
  } = useAutoScrollLock({
    scrollContainerRef,
    contentRef: scrollContentRef,
    active: isMessageRunActive,
  });

  useEffect(() => {
    if (!threadId) return;
    resetToBottom();
  }, [threadId, resetToBottom]);

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
    }

    return {
      blocked: missingAgent || running || unresolvedToolCalls.count > 0,
      reason,
      unresolvedToolCalls,
    };
  }, [
    selectedAgentId,
    orderedMessages,
    toolCallsByMessageId,
    isMessageRunActive,
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
    return 'Resolve pending operations before sending.';
  }, [sendBlockingState]);

  const latestRunError = useMemo(() => {
    if (thread?.status !== 'error') return undefined;
    if (displayItems.length === 0) return undefined;
    return thread.lastError || 'An error occurred during generation.';
  }, [thread?.status, thread?.lastError, displayItems.length]);

  useEffect(() => {
    void useSubAgentStore.getState().ensureLoaded();
  }, []);

  useEffect(() => {
    if (!projectId || !selectedAgentId) return;
    markAgentViewed(projectId, selectedAgentId);
  }, [projectId, selectedAgentId, markAgentViewed]);

  useEffect(() => {
    setMessageLanguageView({});
  }, [selectedAgentId]);

  useEffect(() => {
    setEditingMessageId(null);
    setEditingText('');
    setTranslatingByMessageId({});
  }, [selectedAgentId, threadId]);

  useEffect(() => {
    if (!threadId || !hasStreamingMessage) return;
    if (thread?.status === 'running') return;
    void fetchAndReplaceThreadSnapshot(threadId);
  }, [threadId, hasStreamingMessage, thread?.status]);

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
    void ensureMcpLoaded(activePresetId)
      .then(() => {
        const now = Date.now();
        availableMcpServers.forEach((server) => {
          if (!server.snapshot.synced_at) {
            void syncMcpServer(activePresetId, server.id).catch(() => {});
            return;
          }
          const ageMs = now - new Date(server.snapshot.synced_at).getTime();
          if (ageMs > 10 * 60 * 1000) {
            void syncMcpServer(activePresetId, server.id).catch(() => {});
          }
        });
      })
      .catch(() => {});
  }, [activePresetId, availableMcpServers, ensureMcpLoaded, syncMcpServer]);

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
    if (!secondaryDisplayLanguage) return;
    setTranslatingByMessageId((prev) => {
      const keys = Object.keys(prev).filter((k) => prev[k]);
      if (keys.length === 0) return prev;
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const msgId of keys) {
        const msg = orderedMessages.find((m) => m.id === msgId);
        if (msg && msg.data[secondaryDisplayLanguage]) {
          changed = true;
        } else {
          next[msgId] = true;
        }
      }
      return changed ? next : prev;
    });
  }, [orderedMessages, secondaryDisplayLanguage]);

  useEffect(() => {
    if (!editingMessageId || !secondaryDisplayLanguage) return;
    if (messageLanguageView[editingMessageId] !== 'secondary') return;
    setEditingMessageId(null);
    setEditingText('');
  }, [editingMessageId, messageLanguageView, secondaryDisplayLanguage]);

  useEffect(() => {
    hydratedThreadIdsRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!threadId) return;

    const store = useThreadStore.getState();
    const existingMessages = store.getMessages(threadId);
    if (hydratedThreadIdsRef.current.has(threadId) || existingMessages.length > 0) {
      hydratedThreadIdsRef.current.add(threadId);
      return;
    }

    let cancelled = false;
    void fetchAndReplaceThreadSnapshot(threadId)
      .then(() => {
        if (cancelled) return;
        hydratedThreadIdsRef.current.add(threadId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to hydrate thread messages', { threadId, error });
      });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (selectedContextIds.length === 0) return;
    setSelectedContextIds((prev) => prev.filter((id) => contextIdSet.has(id)));
  }, [contextIdSet, selectedContextIds.length]);

  useEffect(() => {
    if (!isContextDropdownOpen || !projectId) {
      setIsContextPickerLoading(false);
      return;
    }

    let cancelled = false;
    setIsContextPickerLoading(true);

    void refreshProjectObjects(projectId, [
      'story_entity',
      'outline',
      'manuscript',
    ]).catch((loadError) => {
      console.error('Failed to preload agent context objects:', loadError);
    }).finally(() => {
      if (!cancelled) {
        setIsContextPickerLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isContextDropdownOpen, projectId, refreshProjectObjects]);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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

  const formatTimestamp = useCallback((input: Date | string | number | undefined | null) => {
    if (!input) return '';

    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString();
  }, []);

  const scrollToFirstBlockedMessage = useCallback(() => {
    const firstMessageId = sendBlockingState.unresolvedToolCalls.firstMessageId;
    if (!firstMessageId || !scrollContainerRef.current) return;

    const target = scrollContainerRef.current.querySelector(
      `[data-function-call-message-id="${firstMessageId}"]`,
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sendBlockingState.unresolvedToolCalls.firstMessageId]);

  const handleSubmit = useCallback(async (e: React.FormEvent, inputText: string) => {
    e.preventDefault();
    if (!threadId) return;

    const success = await sendThreadMessage({
      threadId,
      projectId,
      threadType: 'agent',
      inputText,
      request: {
        language: sourceLanguage,
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
    sourceLanguage,
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
      scrollToFirstBlockedMessage();
      if (sendBlockedReason) {
        showAlert({ title: 'Cannot Send', message: sendBlockedReason });
      }
      return;
    }
    await handleSubmit(e, inputText);
  }, [
    isMessageRunActive,
    sendBlockingState.blocked,
    scrollToFirstBlockedMessage,
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
      if (!isSupportedAttachmentMimeType(mimeType)) {
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

  const { commitDecisions, commitDecisionsAndPause } = useToolCallDecisions(threadId ?? null);

  const handleStartMessageEdit = useCallback((messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
  }, []);

  const handleCancelMessageEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleSaveMessageEdit = useCallback(async (message: ThreadMessage) => {
    if (!threadId || !editingMessageId || editingSaving) return;
    if (messageLanguageView[message.id] === 'secondary' && secondaryDisplayLanguage) return;
    const content = editingText.trim();
    if (!content) return;

    setEditingSaving(true);
    const state = useThreadStore.getState();
    const existing = state.getMessages(threadId).find((m) => m.id === message.id);
    const existingEntry = existing?.data?.[sourceLanguage]
      ?? Object.values(existing?.data ?? {}).find((v) => v && typeof v === 'object');
    const entry = {
      contentParts: [
        { type: 'content' as const, text: content },
      ],
      reasoningDetail: existingEntry?.reasoningDetail,
    };

    if (existing) {
      state.patchMessage(threadId, message.id, {
        data: {
          ...(existing.data ?? {}),
          [sourceLanguage]: entry,
        },
      });
    }

    try {
      await threadService.updateMessage(threadId, message.id, {
        language: sourceLanguage,
        content_parts: entry.contentParts,
        reasoning_detail: entry.reasoningDetail as any,
      });
      setEditingMessageId(null);
      setEditingText('');
    } catch (error: any) {
      showAlert({ title: 'Edit Failed', message: error?.message ?? 'Failed to update message.' });
    } finally {
      setEditingSaving(false);
    }
  }, [threadId, editingMessageId, editingSaving, editingText, sourceLanguage, messageLanguageView, secondaryDisplayLanguage]);

  const handleTranslateMessage = useCallback(async (message: ThreadMessage, sourceContent: string) => {
    if (!threadId || !secondaryDisplayLanguage) return;
    const text = sourceContent.trim();
    if (!text) return;

    let alreadyTranslating = false;
    setTranslatingByMessageId((prev) => {
      if (prev[message.id]) {
        alreadyTranslating = true;
        return prev;
      }
      return { ...prev, [message.id]: true };
    });
    if (alreadyTranslating) return;

    try {
      await runMessageTranslation({
        projectId,
        sourceThreadId: threadId,
        sourceMessageId: message.id,
        sourceLanguage,
        targetLanguage: secondaryDisplayLanguage,
        sourceContent: text,
      });
    } catch (error: any) {
      showAlert({ title: 'Translation Failed', message: error?.message ?? 'Failed to translate message.' });
      setTranslatingByMessageId((prev) => ({ ...prev, [message.id]: false }));
    }
  }, [threadId, projectId, sourceLanguage, secondaryDisplayLanguage]);

  const handleDeleteMessage = useCallback(async (
    messageId: string,
    role: ThreadMessage['role'],
    linkedToolCallCount: number = 0,
  ) => {
    if (!threadId) {
      showAlert({ title: 'Delete Failed', message: 'Could not find the thread.' });
      return;
    }

    const isAssistantResponse = role === 'assistant';
    const confirmed = await confirm({
      title: isAssistantResponse ? 'Delete Response' : 'Delete Message',
      message: isAssistantResponse
        ? (
            linkedToolCallCount > 0
              ? `Delete this response and its ${linkedToolCallCount} linked operation${linkedToolCallCount === 1 ? '' : 's'}?`
              : 'Are you sure you want to delete this response?'
          )
        : 'Are you sure you want to delete this message?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    const state = useThreadStore.getState();
    const deletePauseContext = getThreadDeletePauseContext(threadId);

    // Find all tool calls linked to this message (via any of the three ID fields)
    const linkedToolCalls = Object.values(state.toolCallsById)
      .filter((tc): tc is ThreadToolCall => Boolean(tc))
      .filter((tc) => tc.threadId === threadId && (
        tc.assistantMessageId === messageId
        || tc.messageId === messageId
      ));

    // Local cleanup first (optimistic)
    for (const tc of linkedToolCalls) {
      if (tc.messageId) state.removeMessage(threadId, tc.messageId);
      state.removeToolCall(tc.id);
    }
    state.removeMessage(threadId, messageId);
    applyOptimisticDeletePause(threadId, deletePauseContext);

    // Backend — for assistant messages, DB cascade handles everything:
    // assistant_message_id CASCADE → deletes tool calls → parent_tool_call_id CASCADE → deletes their messages
    if (isUuid(messageId)) {
      try {
        await threadService.deleteMessage(threadId, messageId);
        await fetchAndReplaceThreadSnapshot(threadId);
      } catch (error) {
        console.error('Failed to delete message:', error);
        await fetchAndReplaceThreadSnapshot(threadId);
      }
    }
  }, [threadId]);

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
    useSidebarStore.getState().closeSidebar(projectId);
  }, [projectId]);

  const panelContent = (
    <div className={`agent-panel ${isAgentVisible ? 'visible' : 'hidden'}`}>
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

      <div className="agent-messages" ref={scrollContainerRef}>
        <div className="agent-messages__content" ref={scrollContentRef}>
          {displayItems.length === 0 && (
            <div className="welcome-message">
              <div className="ai-avatar">{t('agent.ai')}</div>
              <div className="message-content">
                <p>{t('agent.welcomeMessage')}</p>
              </div>
            </div>
          )}

          {displayItems.map((item, index) => {
            const message = item.info;
            const previousItem = index > 0 ? displayItems[index - 1] : null;
            const previousRole = previousItem?.kind === 'assistant_block'
              ? 'assistant'
              : previousItem?.kind === 'user_message'
                ? 'user'
                : null;
            const currentRole = item.kind === 'assistant_block' ? 'assistant' : 'user';
            const isSameRoleAsPrevious = previousRole === currentRole;
            const isStreamingMessage = message.source.isStreaming === true;
            const showRunError = Boolean(latestRunError) && index === displayItems.length - 1;
            const translationAvailable = secondaryDisplayLanguage
              ? Boolean(message.source.data[secondaryDisplayLanguage])
              : false;
            const translating = Boolean(translatingByMessageId[message.source.id]);
            const isEditing = editingMessageId === message.source.id;
            const isSecondaryView = messageLanguageView[message.source.id] === 'secondary' && Boolean(secondaryDisplayLanguage);
            const hasAttachments = message.source.attachments.length > 0;
            const primaryEntry = message.source.data[sourceLanguage];
            const primaryPlainContent = collapseContent(
              primaryEntry?.contentParts ?? message.chatMessage.contentParts,
            );
            const mcpSelections = getMessageMcpSelections(message.source);
            const processed = displayProcessor.process(
              message.chatMessage as any,
              { projectId, surface: (surface ?? 'story-entity') as any },
            );

            if (item.kind === 'assistant_block') {
              const hasSubAgentCalls = item.toolCalls.some((tc) => (
                tc.toolName.startsWith('call_') && Boolean(tc.childThreadId)
              ));
              const isActiveSubAgentParent = message.source.id === lastAssistantMessageId;
              const cards = item.toolCalls.length > 0
                ? buildEditCardsFromToolCallMetadata(item.toolCalls.map(toToolCallMetadata))
                : [];
              const hasAnyPending = item.toolCalls.some((tc) => isBlockingToolCallStatus(tc.status));
              const groupMode = hasAnyPending ? 'pending' : 'confirmed';

              return (
                <React.Fragment key={message.chatMessage.id}>
                  <div className={`agent-message assistant${isSameRoleAsPrevious ? ' same-role-as-previous' : ''}`}>
                    <div className="message-wrapper">
                      {!isSameRoleAsPrevious && (
                        <div className="message-header">
                          <span className="message-role">{t('agent.ai')}</span>
                          <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                        </div>
                      )}

                      {!isEditing && (
                        <ThinkingDisplay
                          messageId={message.chatMessage.id}
                          reasoningDetail={message.chatMessage.reasoning_detail as any}
                          isStreaming={isStreamingMessage}
                        />
                      )}

                      {hasAttachments && (
                        <MessageAttachmentBlock attachments={message.source.attachments} />
                      )}

                      {mcpSelections.length > 0 && (
                        <MessageMcpChipRow selections={mcpSelections} />
                      )}

                      {!isEditing && (primaryPlainContent || isStreamingMessage) && (
                        <div className="message-content">
                          {processed.displayContent}
                          {isStreamingMessage && thread?.status === 'running' && (
                            <div className="typing-indicator inline">
                              <div className="loading-track">
                                <div className="loading-bar" />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {isEditing && (
                        <div className="message-edit">
                          <textarea
                            value={editingText}
                            onChange={(event) => setEditingText(event.target.value)}
                            autoFocus
                          />
                          <div className="edit-actions">
                            <TextButton
                              variant="secondary"
                              onClick={handleCancelMessageEdit}
                              disabled={editingSaving}
                            >
                              {t('agent.cancel')}
                            </TextButton>
                            <TextButton
                              variant="primary"
                              onClick={() => void handleSaveMessageEdit(message.source)}
                              disabled={editingSaving || !editingText.trim()}
                            >
                              {editingSaving ? t('common.loading') : t('agent.save')}
                            </TextButton>
                          </div>
                        </div>
                      )}

                      {cards.length > 0 && (
                        <div className="message-function-calls">
                          {item.toolCallMessageIds.map((mid) => (
                            <span
                              key={mid}
                              className="message-function-call-anchor"
                              data-function-call-message-id={mid}
                            />
                          ))}
                          <FunctionCallsThread
                            threadId={threadId ?? item.toolCalls[0]?.threadId ?? ''}
                            scopeKey={`agent:${selectedAgentId ?? 'none'}:assistant:${message.source.id}`}
                            mode={groupMode}
                            cards={cards}
                            onCommitDecisions={groupMode === 'pending' ? commitDecisions : undefined}
                            onCommitDecisionsAndPause={groupMode === 'pending' ? commitDecisionsAndPause : undefined}
                            projectId={projectId}
                          />
                        </div>
                      )}

                      {selectedAgentId && hasSubAgentCalls && threadId && (
                        <SubAgentPeekDock
                          parentThreadId={threadId}
                          parentMessageId={message.source.id}
                          projectId={projectId}
                          isActiveParent={isActiveSubAgentParent}
                        />
                      )}

                      {showRunError && (
                        <div className="message-error">
                          {latestRunError}
                        </div>
                      )}

                      {!isStreamingMessage && !isEditing && (
                        <div className="message-actions">
                          <div className="action-buttons">
                            {translationAvailable && secondaryDisplayLanguage && (
                              <IconButton
                                icon={<Globe size="sm" />}
                                variant="ghost"
                                size="sm"
                                isActive={isSecondaryView}
                                onClick={() => setMessageLanguageView((prev) => ({
                                  ...prev,
                                  [message.source.id]: prev[message.source.id] === 'secondary' ? 'primary' : 'secondary',
                                }))}
                                title={isSecondaryView
                                  ? t('agent.switchToLanguage', { language: sourceLanguage })
                                  : t('agent.switchToLanguage', { language: secondaryDisplayLanguage })}
                              />
                            )}
                            {secondaryDisplayLanguage && (
                              <IconButton
                                icon={translating ? <CircularArrow size="sm" /> : (translationAvailable ? <CircularArrow size="sm" /> : <Globe size="sm" />)}
                                onClick={() => void handleTranslateMessage(message.source, primaryPlainContent)}
                                title={translationAvailable
                                  ? t('agent.refreshTranslation', { language: secondaryDisplayLanguage })
                                  : t('agent.translateTo', { language: secondaryDisplayLanguage })}
                                variant="ghost"
                                size="sm"
                                disabled={translating || !primaryPlainContent}
                              />
                            )}
                            {!isSecondaryView && (
                              <IconButton
                                icon={<Edit size="sm" />}
                                onClick={() => handleStartMessageEdit(message.source.id, primaryPlainContent)}
                                disabled={!primaryPlainContent}
                                title={t('agent.edit')}
                                variant="ghost"
                                size="sm"
                              />
                            )}
                            <IconButton
                              icon={<Trash size="sm" />}
                              onClick={() => void handleDeleteMessage(message.chatMessage.id, 'assistant', item.toolCalls.length)}
                              title="Delete response"
                              variant="ghost"
                              size="sm"
                              className="icon-button--ghost-danger"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {thread?.memoryBoundaryMessageId === message.source.id && (
                    <div className="agent-archive-divider" role="separator" aria-label="Memory boundary">
                      <div className="agent-archive-divider-line" />
                      <span className="agent-archive-divider-label">Memory boundary</span>
                      <div className="agent-archive-divider-line" />
                    </div>
                  )}
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={message.chatMessage.id}>
                <div className={`agent-message user${isSameRoleAsPrevious ? ' same-role-as-previous' : ''}`}>
                  <div className="message-wrapper">
                    {!isSameRoleAsPrevious && (
                      <div className="message-header">
                        <span className="message-role">{t('agent.you')}</span>
                        <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                      </div>
                    )}

                    {hasAttachments && (
                      <MessageAttachmentBlock attachments={message.source.attachments} />
                    )}

                    {mcpSelections.length > 0 && (
                      <MessageMcpChipRow selections={mcpSelections} />
                    )}

                    {!isEditing && (primaryPlainContent || isStreamingMessage) && (
                      <div className="message-content">
                        {processed.displayContent}
                        {isStreamingMessage && thread?.status === 'running' && (
                          <div className="typing-indicator inline">
                            <div className="loading-track">
                              <div className="loading-bar" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {isEditing && (
                      <div className="message-edit">
                        <textarea
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          autoFocus
                        />
                        <div className="edit-actions">
                          <TextButton
                            variant="secondary"
                            onClick={handleCancelMessageEdit}
                            disabled={editingSaving}
                          >
                            {t('agent.cancel')}
                          </TextButton>
                          <TextButton
                            variant="primary"
                            onClick={() => void handleSaveMessageEdit(message.source)}
                            disabled={editingSaving || !editingText.trim()}
                          >
                            {editingSaving ? t('common.loading') : t('agent.save')}
                          </TextButton>
                        </div>
                      </div>
                    )}

                    {showRunError && (
                      <div className="message-error">
                        {latestRunError}
                      </div>
                    )}

                    {!isStreamingMessage && !isEditing && (
                      <div className="message-actions">
                        <div className="action-buttons">
                          {translationAvailable && secondaryDisplayLanguage && (
                            <IconButton
                              icon={<Globe size="sm" />}
                              variant="ghost"
                              size="sm"
                              isActive={isSecondaryView}
                              onClick={() => setMessageLanguageView((prev) => ({
                                ...prev,
                                [message.source.id]: prev[message.source.id] === 'secondary' ? 'primary' : 'secondary',
                              }))}
                              title={isSecondaryView
                                ? t('agent.switchToLanguage', { language: sourceLanguage })
                                : t('agent.switchToLanguage', { language: secondaryDisplayLanguage })}
                            />
                          )}
                          {!isSecondaryView && (
                            <IconButton
                              icon={<Edit size="sm" />}
                              onClick={() => handleStartMessageEdit(message.source.id, primaryPlainContent)}
                              disabled={!primaryPlainContent}
                              title={t('agent.edit')}
                              variant="ghost"
                              size="sm"
                            />
                          )}
                          <IconButton
                            icon={<Trash size="sm" />}
                            onClick={() => void handleDeleteMessage(message.chatMessage.id, 'user')}
                            title={t('agent.delete')}
                            variant="ghost"
                            size="sm"
                            className="icon-button--ghost-danger"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {thread?.memoryBoundaryMessageId === message.source.id && (
                  <div className="agent-archive-divider" role="separator" aria-label="Memory boundary">
                    <div className="agent-archive-divider-line" />
                    <span className="agent-archive-divider-label">Memory boundary</span>
                    <div className="agent-archive-divider-line" />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {isMessageRunActive && !hasStreamingMessage && liveView?.noticeKind === 'preexisting_live_run' && (
            <PreexistingLiveRunNotice />
          )}

          {isMessageRunActive
            && !hasStreamingMessage
            && liveView?.noticeKind !== 'preexisting_live_run'
            && thread?.status === 'running' && (
            <div className="typing-indicator">
              <div className="loading-track">
                <div className="loading-bar" />
              </div>
            </div>
          )}
        </div>

        {showScrollButton && (
          <IconButton
            className="scroll-to-bottom-button"
            icon={<ChevronDown size="sm" />}
            onClick={() => scrollToBottom()}
            title={t('agent.scrollToBottom')}
            variant="secondary"
          />
        )}
      </div>

      <div className="agent-input-container" ref={contextDropdownRef}>
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
              onChange={(ids) => setSelectedContextIds(ids as string[])}
              projectId={projectId}
              language={sourceLanguage}
              loading={isContextPickerLoading}
              maxHeight="350px"
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
