import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '../../../store/agentStore';
import { makeProjectAgentKey, useAgentUIStore } from '../../../store/agentUIStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useProjectStore } from '../../../store/projectStore';
import { useSettings } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import { useLLMSessionStore } from '../../../store/llmSessionStore';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import AgentSidebar from '../../../components/Agent/AgentSidebar';
import { DefaultDisplayProcessor } from '../../../agent/processors/DisplayProcessor';
import type { ChatMessage, ToolCallMetadata } from '../../../llm/requestTypes';
import ThinkingDisplay from '../../../components/common/ThinkingDisplay';
import { FunctionCallsThread } from '../../../toolCall/ui';
import { SubAgentPeekDock } from '../../../components/SubAgentPeek';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import AgentRunModeToggle from '../../../components/ui/AgentRunModeToggle';
import { collapseContentParts } from '../../../agent/utils/contentParts';
import { Settings, Edit, Trash, Globe, CircularArrow, ChevronDown, Send, Stop } from '../../../components/icons';
import { useAgentOrchestration } from '../../../agent/hooks';
import { runAgentTranslation } from '../../../agent';
import { buildEditCardsFromToolCallMetadata } from '../../../toolCall';
import type { ToolCallDecisionMap } from '../../../toolCall/types';
import { getSendBlockingState, getSendBlockedReasonMessage } from '../../../toolCall/viewModel/blockingSelectors';
import type { AgentRunMode, WorkspaceSurface } from '../../../types/agentRuntime';
import {
    threadOrchestrator,
    useThreadStore,
    useConversationTimeline,
    resolveRunMessageDisplay,
    type ConversationMessage,
    type ThreadToolCall,
} from '../../../runtime';

interface AgentPanelProps
{
    projectId: string;
    runMode: AgentRunMode;
    surface: WorkspaceSurface;
}

interface AgentContextTriggerProps {
    selectedCount: number;
    totalCount: number;
    isOpen: boolean;
    onClick: () => void;
}

const AgentContextTrigger: React.FC<AgentContextTriggerProps> = React.memo(({
    selectedCount,
    totalCount,
    isOpen,
    onClick
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

// Separate component for input form to avoid re-rendering messages on typing
interface AgentInputFormProps {
    projectId: string;
    isLoading: boolean;
    isSendBlocked: boolean;
    sendBlockedReason?: string | null;
    onSubmit: (e: React.FormEvent, input: string) => Promise<void>;
    onStop: () => void;
}

const AgentInputForm: React.FC<AgentInputFormProps> = React.memo(({
    projectId,
    isLoading,
    isSendBlocked,
    sendBlockedReason,
    onSubmit,
    onStop
}) => {
    const { t } = useTranslation();
    const input = useAgentUIStore((state) => state.inputByProject[projectId] ?? '');
    const setInput = useAgentUIStore((state) => state.setInput);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        if (isSendBlocked || isLoading) {
            e.preventDefault();
            return;
        }
        onSubmit(e, input);
    }, [onSubmit, input, isSendBlocked, isLoading]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (isSendBlocked || isLoading) return;
            onSubmit(e as any, input);
        }
    }, [onSubmit, input, isSendBlocked, isLoading]);

    return (
        <form onSubmit={handleSubmit} className="agent-form">
            {!isLoading && isSendBlocked && sendBlockedReason && (
                <div className="agent-send-blocker-hint" role="status">
                    {sendBlockedReason}
                </div>
            )}
            <div className="input-group">
                <textarea
                    value={input}
                    onChange={(e) => setInput(projectId, e.target.value)}
                    placeholder={t('agent.enterMessage')}
                    rows={1}
                    className="agent-input"
                    onKeyDown={handleKeyDown}
                />
                {isLoading ? (
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
                        disabled={isSendBlocked}
                    />
                )}
            </div>
        </form>
    );
});

// Separate component for message edit form to avoid re-rendering all messages on typing
interface MessageEditFormProps {
    projectId: string;
    editTextareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
    onEditContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
}

const MessageEditForm: React.FC<MessageEditFormProps> = React.memo(({
    projectId,
    editTextareaRef,
    onEditContentChange,
    onSaveEdit,
    onCancelEdit
}) => {
    const { t } = useTranslation();
    const editingContent = useAgentUIStore((state) => state.editingByProject[projectId]?.content ?? '');

    return (
        <div className="message-edit">
            <textarea
                ref={editTextareaRef}
                value={editingContent}
                onChange={onEditContentChange}
                placeholder={t('agent.editContent')}
            />
            <div className="edit-actions">
                <TextButton
                    variant="primary"
                    size="sm"
                    onClick={onSaveEdit}
                >
                    {t('agent.save')}
                </TextButton>
                <TextButton variant="secondary" size="sm" onClick={onCancelEdit}>{t('agent.cancel')}</TextButton>
            </div>
        </div>
    );
});

interface DisplayMessageInfo
{
    source: ConversationMessage;
    chatMessage: ChatMessage;
    requestedLanguage: string;
    displayLanguage: string;
    hasRequestedLanguage: boolean;
    fallbackLanguage: string | null;
}

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
    return {
        id: toolCall.llmCallId,
        tool_name: toolCall.toolName,
        arguments: toolCall.arguments,
        status: toolCall.status as any,
        reason: toolCall.reason ?? undefined,
        failureType: toolCall.status === 'failed'
            ? (toolCall.reason?.startsWith('VALIDATION::') ? 'validation' : 'execution')
            : undefined,
        result: toolCall.result as any,
        acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
    };
}

const AgentPanel: React.FC<AgentPanelProps> = ({
    projectId,
    runMode,
    surface,
}) =>
{
    const { t } = useTranslation();

    // Agent orchestration - all agent logic is handled internally
    const {
        agentHandlers,
        contextIds,
    } = useAgentOrchestration({ projectId, runMode, surface });

    const preflightToast = useAgentUIStore((state) => state.preflightToastByProject[projectId] ?? null);

    // Destructure for easier access
    const { selectedContextIds, setSelectedContextIds: onContextIdsChange, totalObjectCount } = contextIds;
    const {
        handleSubmit: onSubmit,
        handleStop: onStop,
        handleEditMessage: onEditMessage,
        handleEditContentChange: onEditContentChange,
        handleSaveEdit: onSaveEdit,
        handleCancelEdit: onCancelEdit,
        handleDeleteMessage: onDeleteMessage,
        handleSelectAgent: onSelectAgent,
        editTextareaRef,
    } = agentHandlers;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isUserNearBottomRef = useRef(true);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
    const contextDropdownRef = useRef<HTMLDivElement>(null);
    const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);

    const selectedAgentId = useAgentStore((state) => state.selectedAgentByProject[projectId]);
    const isLoading = useAgentUIStore((state) => {
        if (!selectedAgentId) return false;
        return state.loadingByProjectAgent[makeProjectAgentKey(projectId, selectedAgentId)] ?? false;
    });

    // Use shallow selector to combine multiple store reads into one (reduces re-renders)
    const { agentVisibleState, editingMessageId, setAgentVisible, markAgentViewed } = useAgentUIStore(
        useShallow((state) => ({
            agentVisibleState: state.agentVisibleByProject[projectId] ?? false,
            editingMessageId: state.editingByProject[projectId]?.messageId ?? null,
            setAgentVisible: state.setAgentVisible,
            markAgentViewed: state.markAgentViewed,
        }))
    );

    // Handle desktop visibility separately to avoid selector side effects
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    const isAgentVisible = isDesktop ? true : agentVisibleState;

    const { getCurrentProject } = useProjectStore();
    const settings = useSettings();
    const showError = useErrorStore((state) => state.showError);
    const novelEditorStore = useNovelEditorStore();

    // Check if editor has unsaved changes (only relevant in novel-editor surface)
    const hasUnsavedChanges = surface === 'novel-editor'
        ? novelEditorStore.getHasUnsavedChanges(projectId)
        : false;

    const mainLanguage = settings.mainLanguage;
    const defaultSubLanguage = settings.defaultSubLanguage;

    // Get selected agent for name + archive boundary
    const agentSelector = useMemo(
        () => (state: ReturnType<typeof useAgentStore.getState>) => {
            const agentId = state.selectedAgentByProject[projectId];
            if (!agentId) return undefined;
            return state.agentsByProject[projectId]?.find((a) => a.id === agentId);
        },
        [projectId]
    );
    const selectedAgent = useAgentStore(agentSelector);
    const archiveBoundaryId = selectedAgent?.archived_until_message_id ?? null;

    // Resolve threadId from agent
    const selectedThreadId = useMemo(() => {
        if (!selectedAgentId) return undefined;
        const agent = useAgentStore.getState().agentsByProject[projectId]?.find(a => a.id === selectedAgentId);
        return agent?.thread_id ?? undefined;
    }, [projectId, selectedAgentId]);

    // Conversation timeline — single source of truth for messages
    const { messages: timelineMessages, messageIds: runMessageIds } = useConversationTimeline(selectedThreadId);

    const { toolCallsByMessageId, threadStatus, threadError, pendingToolCallMessageId, isThreadStreamActive } = useThreadStore(
        useShallow((state) => ({
            toolCallsByMessageId: state.toolCallsByMessageId,
            threadStatus: selectedThreadId ? state.threadsById[selectedThreadId]?.status : undefined,
            threadError: selectedThreadId ? state.threadsById[selectedThreadId]?.lastError ?? null : null,
            pendingToolCallMessageId: selectedThreadId ? state.pendingToolCallMessageByThread[selectedThreadId] : undefined,
            isThreadStreamActive: selectedThreadId ? Boolean(state.activeStreamByThread[selectedThreadId]) : false,
        }))
    );

    const [translatingMessages, setTranslatingMessages] = useState<Record<string, boolean>>({});
    const [translationErrors, setTranslationErrors] = useState<Record<string, string | null>>({});
    const [translationSessionByMessageId, setTranslationSessionByMessageId] = useState<Record<string, string>>({});
    const translationSessionByMessageIdRef = useRef(translationSessionByMessageId);
    useEffect(() => {
        translationSessionByMessageIdRef.current = translationSessionByMessageId;
    }, [translationSessionByMessageId]);

    // Per-message language view: tracks which messages are showing translation
    const [messageLanguageView, setMessageLanguageView] = useState<Record<string, 'primary' | 'secondary'>>({});
    // Mobile agent overlay closing animation state
    const [isOverlayClosing, setIsOverlayClosing] = useState(false);

    const handleCloseAgent = useCallback(() => {
        setIsOverlayClosing(true);
        setAgentVisible(projectId, false);
    }, [projectId, setAgentVisible]);

    const handleOverlayAnimationEnd = useCallback((e: React.AnimationEvent) => {
        if (e.animationName === 'overlayFadeOut') {
            setAgentVisible(projectId, false);
            setIsOverlayClosing(false);
        }
    }, [projectId, setAgentVisible]);

    // Close context dropdown on click outside or escape key
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

    const currentProject = getCurrentProject();

    const formatTimestamp = useCallback((input: Date | string | number | undefined | null) =>
    {
        if (!input) return '';

        const date = input instanceof Date ? input : new Date(input);
        if (Number.isNaN(date.getTime()))
        {
            return '';
        }

        return date.toLocaleTimeString();
    }, []);

    useEffect(() =>
    {
        setTranslatingMessages({});
        setTranslationErrors({});
    }, [selectedAgentId]);

    useEffect(() => {
        if (!projectId || !selectedAgentId) return;
        markAgentViewed(projectId, selectedAgentId);
    }, [projectId, selectedAgentId, markAgentViewed]);

    useEffect(() =>
    {
        // If secondary language disappears, reset all per-message views to primary
        if (!defaultSubLanguage) {
            setMessageLanguageView({});
        }
    }, [defaultSubLanguage]);

    // Scroll event handler to detect user's scroll position
    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const threshold = 100; // pixels from bottom
        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

        isUserNearBottomRef.current = isNearBottom;
        // Show scroll button only when scrolled up AND streaming is active
        setShowScrollButton(!isNearBottom && isLoading);
    }, [isLoading]);

    // Attach scroll listener to container
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    // Auto-scroll only when user is near bottom (instant during streaming)
    useEffect(() =>
    {
        if (isUserNearBottomRef.current && scrollContainerRef.current)
        {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: 'instant'
            });
        }
    }, [timelineMessages, isLoading]);

    // Hide scroll button when streaming stops
    useEffect(() => {
        if (!isLoading) {
            setShowScrollButton(false);
        }
    }, [isLoading]);


    const resolveDisplayInfo = useCallback(
        (msg: ConversationMessage): DisplayMessageInfo =>
        {
            // For virtual streaming messages, use streaming data directly
            if (msg.isStreaming) {
                const streamingEntry = msg.data['_streaming'];
                return {
                    source: msg,
                    chatMessage: {
                        id: msg.id,
                        role: msg.role,
                        contentParts: (streamingEntry?.contentParts ?? []) as any,
                        thinking_details: streamingEntry?.thinkingDetails,
                        timestamp: msg.createdAt,
                    } as any,
                    requestedLanguage: mainLanguage,
                    displayLanguage: mainLanguage,
                    hasRequestedLanguage: true,
                    fallbackLanguage: null,
                };
            }

            // Check per-message language preference
            const messageView = messageLanguageView[msg.id];
            const wantsTranslation = Boolean(messageView === 'secondary' && defaultSubLanguage);
            const requestedLanguage = wantsTranslation && defaultSubLanguage ? defaultSubLanguage : mainLanguage;

            const resolved = resolveRunMessageDisplay(
                msg,
                requestedLanguage,
                defaultSubLanguage ?? undefined,
            );

            return {
                source: msg,
                chatMessage: {
                    id: msg.id,
                    role: msg.role,
                    contentParts: resolved.contentParts as any,
                    thinking_details: resolved.thinkingDetails,
                    timestamp: msg.createdAt,
                } as any,
                requestedLanguage,
                displayLanguage: resolved.displayLanguage,
                hasRequestedLanguage: !resolved.isFallback,
                fallbackLanguage: resolved.isFallback ? resolved.displayLanguage : null,
            };
        },
        [messageLanguageView, mainLanguage, defaultSubLanguage]
    );

    const displayMessages = useMemo(
        () => timelineMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(resolveDisplayInfo),
        [timelineMessages, resolveDisplayInfo]
    );

    const hasStreamingMessage = useMemo(
        () => timelineMessages.some(m => m.isStreaming),
        [timelineMessages]
    );

    const lastAssistantMessageId = useMemo(() => {
        for (let i = timelineMessages.length - 1; i >= 0; i--) {
            const msg = timelineMessages[i];
            if (msg.role === 'assistant' && !msg.isStreaming) {
                return msg.id;
            }
        }
        return null;
    }, [timelineMessages]);

    const sendBlockingState = useMemo(() => (
        getSendBlockingState({
            selectedAgentId,
            messageIds: runMessageIds,
            toolCallsByMessageId,
            isThreadStreamActive,
        })
    ), [selectedAgentId, runMessageIds, toolCallsByMessageId, isThreadStreamActive]);

    const sendBlockedReason = useMemo(() => {
        return getSendBlockedReasonMessage(sendBlockingState);
    }, [sendBlockingState]);

    useEffect(() => {
        function processFinished() {
            const sessionMap = translationSessionByMessageIdRef.current;
            if (Object.keys(sessionMap).length === 0) return;

            const allSessions = useLLMSessionStore.getState().sessions;
            const finished: Array<{ messageId: string; sessionId: string; status: string; error?: string }> = [];

            for (const [messageId, sessionId] of Object.entries(sessionMap)) {
                const session = allSessions[sessionId];
                if (!session) continue;
                if (session.status === 'running' || session.status === 'applying') continue;
                finished.push({ messageId, sessionId, status: session.status, error: session.error });
            }

            if (finished.length === 0) return;

            setTranslationSessionByMessageId(prev => {
                const next = { ...prev };
                for (const item of finished) {
                    delete next[item.messageId];
                }
                return next;
            });

            setTranslatingMessages(prev => {
                const next = { ...prev };
                for (const item of finished) {
                    next[item.messageId] = false;
                }
                return next;
            });

            setTranslationErrors(prev => {
                const next = { ...prev };
                for (const item of finished) {
                    next[item.messageId] = item.status === 'error' ? (item.error ?? 'Unknown error occurred during translation.') : null;
                }
                return next;
            });

            setMessageLanguageView(prev => {
                const next = { ...prev };
                for (const item of finished) {
                    if (item.status === 'success') {
                        next[item.messageId] = 'secondary';
                    }
                }
                return next;
            });

            for (const item of finished) {
                if (item.status === 'error') {
                    showError('Translation Failed', item.error ?? 'Unknown error occurred during translation.');
                }
            }
        }

        // Process immediately in case sessions already finished
        processFinished();

        // Subscribe to LLM session store to detect when translation sessions complete
        const unsubscribe = useLLMSessionStore.subscribe(processFinished);
        return unsubscribe;
    }, [showError]);

    const translateMessage = async (msg: ConversationMessage) =>
    {
        if (!defaultSubLanguage)
        {
            showError('Translation Failed', 'No default translation language configured. Add sub languages in Settings.');
            return;
        }
        if (!selectedAgentId)
        {
            showError('Translation Failed', 'No active agent selected.');
            return;
        }

        const preferredSourceLanguage = mainLanguage;
        const targetLanguage = defaultSubLanguage;
        const sourceEntry = msg.data[preferredSourceLanguage]
            ? { language: preferredSourceLanguage, data: msg.data[preferredSourceLanguage] }
            : (() => {
                const languages = Object.keys(msg.data);
                if (languages.length === 0) return undefined;
                // Prefer mainLanguage, then defaultSubLanguage, then first available
                const lang = languages.includes(preferredSourceLanguage)
                    ? preferredSourceLanguage
                    : defaultSubLanguage && languages.includes(defaultSubLanguage)
                        ? defaultSubLanguage
                        : languages[0];
                return { language: lang, data: msg.data[lang] };
            })();

        if (!sourceEntry)
        {
            showError('Translation Failed', `No content available to translate.`);
            return;
        }

        const sourceLanguage = sourceEntry.language;
        const contentParts = sourceEntry.data?.contentParts ?? [];
        const { content: sourceContent } = collapseContentParts(contentParts as any);

        if (!sourceContent.trim())
        {
            showError('Translation Failed', `No ${sourceLanguage} content available to translate.`);
            return;
        }

        setTranslatingMessages(prev => ({ ...prev, [msg.id]: true }));
        setTranslationErrors(prev => ({ ...prev, [msg.id]: null }));

        void runAgentTranslation({
            projectId,
            agentId: selectedAgentId,
            threadId: msg.threadId,
            messageId: msg.id,
            sourceLanguage,
            targetLanguage,
            sourceContent,
            originalContentParts: contentParts as any,
        }).then((sessionId) => {
            setTranslationSessionByMessageId(prev => ({ ...prev, [msg.id]: sessionId }));
        });
    };

    const renderMessageContent = (
        message: DisplayMessageInfo,
        processed: { displayContent: React.ReactNode }
    ) =>
    {
        return (
            <div className="message-content">
                {!message.hasRequestedLanguage && (
                    <div className="language-fallback-badge">
                        {t('agent.usingLanguage', { language: message.fallbackLanguage || message.displayLanguage })}
                    </div>
                )}
                {processed.displayContent}
                {message.source.isStreaming && (
                    <div className="typing-indicator inline">
                        <div className="loading-track">
                            <div className="loading-bar" />
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const scrollToFirstBlockedMessage = useCallback(() => {
        const firstMessageId = sendBlockingState.unresolvedToolCalls.firstMessageId;
        if (!firstMessageId || !scrollContainerRef.current) return;

        const target = scrollContainerRef.current.querySelector(
            `[data-function-call-message-id="${firstMessageId}"]`
        );
        if (target instanceof HTMLElement) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [sendBlockingState.unresolvedToolCalls.firstMessageId]);

    const handleSubmitFromInput = useCallback(async (e: React.FormEvent, input: string) => {
        if (isLoading) {
            e.preventDefault();
            return;
        }

        if (sendBlockingState.blocked) {
            e.preventDefault();
            scrollToFirstBlockedMessage();
            if (sendBlockedReason) {
                showError('Cannot Send', sendBlockedReason);
            }
            return;
        }

        await onSubmit(e, input);
    }, [isLoading, sendBlockingState.blocked, scrollToFirstBlockedMessage, sendBlockedReason, showError, onSubmit]);

    const translationEnabled = Boolean(defaultSubLanguage && defaultSubLanguage !== mainLanguage);
    const translationTargetLabel = defaultSubLanguage || 'secondary language';

    // Compute latest run error (shown on last message)
    const latestRunError = useMemo(() => {
        if (threadStatus !== 'error') return undefined;
        if (timelineMessages.length === 0) return undefined;
        const lastMsg = timelineMessages[timelineMessages.length - 1];
        if (lastMsg.isStreaming) return undefined;
        return threadError || 'An error occurred during generation.';
    }, [timelineMessages, threadStatus, threadError]);

    return (
        <div className={`agent-panel ${isAgentVisible ? 'visible' : 'hidden'}`}>
            <div className="agent-header">
                <div className="agent-header-left">
                    <TextButton
                        variant="secondary"
                        size="sm"
                        onClick={() => useSidebarStore.getState().toggleSidebar(projectId, 'agent')}
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
                {displayMessages.length === 0 && (
                    <div className="welcome-message">
                        <div className="ai-avatar">{t('agent.ai')}</div>
                        <div className="message-content">
                            <p>{t('agent.welcomeMessage')}</p>
                            {currentProject && (
                                <p>{t('agent.projectHelp', { projectName: currentProject.name })}</p>
                            )}
                        </div>
                    </div>
                )}

                {displayMessages.map((message, index) =>
                {
                    const previousMessage = index > 0 ? displayMessages[index - 1] : null;
                    const isSameRoleAsPrevious = previousMessage?.chatMessage.role === message.chatMessage.role;
                    const isUser = message.chatMessage.role === 'user';
                    const isEditing = editingMessageId === message.chatMessage.id;
                    const processingResult = displayProcessor.process(message.chatMessage as any, { projectId, surface } as any);
                    const isTranslating = Boolean(translatingMessages[message.source.id]);
                    const isStreamingMessage = message.source.isStreaming === true;

                    // Get primary language content for edit button
                    const primaryEntry = message.source.data[mainLanguage];
                    const primaryContentParts = primaryEntry?.contentParts ?? message.chatMessage.contentParts;
                    const { content: primaryPlainContent } = collapseContentParts(primaryContentParts as any);

                    const translationAvailable = defaultSubLanguage ? Boolean(message.source.data[defaultSubLanguage]) : false;
                    const translateButtonLabel = translationAvailable
                        ? t('agent.refreshTranslation', { language: translationTargetLabel })
                        : t('agent.translateTo', { language: translationTargetLabel });
                    const translateDisabled = !translationEnabled || isTranslating;

                    // Persisted tool calls (for real messages)
                    const storedToolCalls = !isStreamingMessage
                        ? (toolCallsByMessageId[message.source.id] ?? []).map(toToolCallMetadata)
                        : [];
                    const cardsToRender = storedToolCalls.length > 0
                        ? buildEditCardsFromToolCallMetadata(storedToolCalls)
                        : [];
                    const hasEditCards = cardsToRender.length > 0;
                    const hasPendingCards = storedToolCalls.some((toolCall: any) => {
                        const status = String(toolCall?.status ?? 'pending');
                        return status === 'pending' || status === 'running';
                    });
                    const cardMode = hasPendingCards ? 'pending' : 'confirmed';
                    const functionThreadId = `agent:${selectedAgentId ?? 'none'}:${message.source.id}`;
                    const subAgentToolCallIds = cardsToRender
                        .filter((card: any) => typeof card?.toolCall?.toolName === 'string' && card.toolCall.toolName.startsWith('call_'))
                        .map((card: any) => card.toolCall.id);
                    const hasSubAgentCalls = subAgentToolCallIds.length > 0;
                    const isActiveSubAgentParent = message.source.id === lastAssistantMessageId;

                    // Run error — show only on the last message
                    const showRunError = latestRunError && index === displayMessages.length - 1;

                    return (
                        <React.Fragment key={message.chatMessage.id}>
                            <div
                                className={`agent-message ${message.chatMessage.role}${isEditing ? ' editing' : ''}${isSameRoleAsPrevious ? ' same-role-as-previous' : ''}`}
                            >
                                <div className="message-wrapper">
                                {!isSameRoleAsPrevious && (
                                    <div className="message-header">
                                        <span className="message-role">{isUser ? t('agent.you') : t('agent.ai')}</span>
                                        <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                                    </div>
                                )}

                                        {isEditing ? (
                                            <MessageEditForm
                                                projectId={projectId}
                                                editTextareaRef={editTextareaRef}
                                                onEditContentChange={onEditContentChange}
                                                onSaveEdit={onSaveEdit}
                                                onCancelEdit={onCancelEdit}
                                            />
                                        ) : (
                                            <>
                                                {/* Show thinking above the message bubble */}
                                                {message.chatMessage.role === 'assistant' && (
                                                    <ThinkingDisplay
                                                        messageId={message.chatMessage.id}
                                                        contentParts={message.chatMessage.contentParts}
                                                        isStreaming={isStreamingMessage}
                                                    />
                                                )}
                                                {(primaryPlainContent.trim() || isStreamingMessage) && renderMessageContent(message, processingResult)}
                                                {hasEditCards && (
                                                    <div
                                                        className="message-function-calls"
                                                        data-function-call-message-id={message.source.id}
                                                    >
                                                        <FunctionCallsThread
                                                            threadId={`${functionThreadId}:cards`}
                                                            mode={cardMode as any}
                                                            cards={cardsToRender as any}
                                                            onCommitDecisions={
                                                                cardMode === 'pending'
                                                                    ? async (decisions: ToolCallDecisionMap) => {
                                                                        if (hasUnsavedChanges) {
                                                                            showError('Cannot Apply', 'Save your changes first - unsaved work will be overwritten.');
                                                                            return;
                                                                        }

                                                                        if (storedToolCalls.length === 0 || !selectedThreadId) return;

                                                                        await threadOrchestrator.toolDecisions({
                                                                            projectId,
                                                                            threadId: selectedThreadId,
                                                                            messageId: message.source.id,
                                                                            decisions,
                                                                        });
                                                                    }
                                                                    : undefined
                                                            }
                                                            onCommitDecisionsAndPause={
                                                                cardMode === 'pending'
                                                                    ? async (decisions: ToolCallDecisionMap) => {
                                                                        if (hasUnsavedChanges) {
                                                                            showError('Cannot Apply', 'Save your changes first - unsaved work will be overwritten.');
                                                                            return;
                                                                        }

                                                                        if (storedToolCalls.length === 0 || !selectedThreadId) return;

                                                                        await threadOrchestrator.toolDecisions({
                                                                            projectId,
                                                                            threadId: selectedThreadId,
                                                                            messageId: message.source.id,
                                                                            decisions,
                                                                        });
                                                                        await threadOrchestrator.pause(projectId, selectedThreadId);
                                                                    }
                                                                    : undefined
                                                            }
                                                            projectId={projectId}
                                                            isApplyDisabled={hasUnsavedChanges}
                                                            applyDisabledReason={
                                                                hasUnsavedChanges
                                                                    ? 'Save your changes first - unsaved work will be overwritten'
                                                                    : undefined
                                                            }
                                                        />
                                                    </div>
                                                )}

                                                {!hasEditCards && pendingToolCallMessageId === message.source.id && (
                                                    <div className="message-function-calls">
                                                        <div className="typing-indicator">
                                                            <div className="loading-track">
                                                                <div className="loading-bar" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {selectedAgentId && hasSubAgentCalls && selectedThreadId && (
                                                    <SubAgentPeekDock
                                                        parentThreadId={selectedThreadId}
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

                                                {!isStreamingMessage && (
                                                    <div className="message-actions">
                                                        {translationErrors[message.source.id] && (
                                                            <div className="translation-error">{translationErrors[message.source.id]}</div>
                                                        )}
                                                        <div className="action-buttons">
                                                            {/* Per-message language toggle - only show when translation exists */}
                                                            {translationAvailable && (
                                                                <IconButton
                                                                    icon={<Globe size="sm" />}
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    isActive={messageLanguageView[message.source.id] === 'secondary'}
                                                                    onClick={() => setMessageLanguageView(prev => ({
                                                                        ...prev,
                                                                        [message.source.id]: prev[message.source.id] === 'secondary' ? 'primary' : 'secondary'
                                                                    }))}
                                                                    title={messageLanguageView[message.source.id] === 'secondary'
                                                                        ? t('agent.switchToLanguage', { language: mainLanguage })
                                                                        : t('agent.switchToLanguage', { language: defaultSubLanguage })
                                                                    }
                                                                />
                                                            )}
                                                            {translationEnabled && (
                                                                <IconButton
                                                                    icon={isTranslating ? <CircularArrow size="sm" /> : translationAvailable ? <CircularArrow size="sm" /> : <Globe size="sm" />}
                                                                    onClick={() => translateMessage(message.source)}
                                                                    disabled={translateDisabled}
                                                                    title={translateButtonLabel}
                                                                    variant="ghost"
                                                                    size="sm"
                                                                />
                                                            )}
                                                            <IconButton
                                                                icon={<Edit size="sm" />}
                                                                onClick={() => {
                                                                    // Switch to primary view for this message when editing
                                                                    setMessageLanguageView(prev => ({
                                                                        ...prev,
                                                                        [message.source.id]: 'primary'
                                                                    }));
                                                                    onEditMessage(message.chatMessage.id, primaryPlainContent, mainLanguage);
                                                                }}
                                                                disabled={isTranslating || !primaryPlainContent.trim()}
                                                                title={t('agent.edit')}
                                                                variant="ghost"
                                                                size="sm"
                                                            />
                                                            <IconButton
                                                                icon={<Trash size="sm" />}
                                                                onClick={() => onDeleteMessage(message.chatMessage.id)}
                                                                disabled={isTranslating}
                                                                title={t('agent.delete')}
                                                                variant="ghost"
                                                                size="sm"
                                                                className="icon-button--ghost-danger"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                </div>
                            </div>

                            {archiveBoundaryId === message.source.id && (
                                <div className="agent-archive-divider" role="separator" aria-label="Memory boundary">
                                    <div className="agent-archive-divider-line" />
                                    <span className="agent-archive-divider-label">Memory boundary</span>
                                    <div className="agent-archive-divider-line" />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}

                {isLoading && !hasStreamingMessage && threadStatus === 'running' && (
                    <div className="typing-indicator">
                        <div className="loading-track">
                            <div className="loading-bar" />
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />

                {showScrollButton && (
                    <IconButton
                        className="scroll-to-bottom-button"
                        icon={<ChevronDown size="sm" />}
                        onClick={() => {
                            if (scrollContainerRef.current) {
                                isUserNearBottomRef.current = true;
                                scrollContainerRef.current.scrollTo({
                                    top: scrollContainerRef.current.scrollHeight,
                                    behavior: 'smooth'
                                });
                                setShowScrollButton(false);
                            }
                        }}
                        title={t('agent.scrollToBottom')}
                        variant="primary"
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
                    <ObjectPicker
                        mode="all"
                        selectionMode="multi"
                        selectedIds={selectedContextIds}
                        onChange={(ids) => onContextIdsChange(ids as string[])}
                        projectId={projectId}
                        language={mainLanguage}
                        maxHeight="350px"
                        showSearch={true}
                        showSelectAll={true}
                        showTokenCount={true}
                    />
                </div>

                <div className="agent-controls-row">
                    <AgentRunModeToggle
                        currentRunMode={runMode}
                        onRunModeChange={(next) => useAgentUIStore.getState().setRunMode(projectId, next)}
                    />
                    <AgentContextTrigger
                        selectedCount={selectedContextIds.length}
                        totalCount={totalObjectCount}
                        isOpen={isContextDropdownOpen}
                        onClick={() => setIsContextDropdownOpen(!isContextDropdownOpen)}
                    />
                </div>
                <AgentInputForm
                    projectId={projectId}
                    isLoading={isLoading}
                    isSendBlocked={sendBlockingState.blocked}
                    sendBlockedReason={sendBlockedReason}
                    onSubmit={handleSubmitFromInput}
                    onStop={onStop}
                />
            </div>

            <AgentSidebar
                projectId={projectId}
                onSelectAgent={onSelectAgent}
            />

            {(isAgentVisible || isOverlayClosing) && createPortal(
                <div
                    className={`agent-overlay mobile-only ${isOverlayClosing ? 'closing' : ''}`}
                    onClick={handleCloseAgent}
                    onAnimationEnd={handleOverlayAnimationEnd}
                />,
                document.getElementById('root') || document.body
            )}
        </div>
    );
};

export default AgentPanel;
