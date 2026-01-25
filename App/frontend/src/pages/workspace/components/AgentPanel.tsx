import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type StoredAgentMessage } from '../../../store/agentStore';
import { useAgentUIStore } from '../../../store/agentUIStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useProjectStore } from '../../../store/projectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import { useLLMSessionStore } from '../../../store/llmSessionStore';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import AgentSidebar from '../../../components/Agent/AgentSidebar';
import { DefaultDisplayProcessor } from '../../../agent/processors/DisplayProcessor';
import type { ChatMessage } from '../../../llm/requestTypes';
import ThinkingDisplay from '../../../components/common/ThinkingDisplay';
import { ToolCallCard } from '../../../components/toolCall';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import AgentModeToggle from '../../../components/ui/AgentModeToggle';
import { collapseContentParts } from '../../../agent/utils/contentParts';
import { Settings, Edit, Trash, Globe, CircularArrow, ChevronDown, Send, Stop } from '../../../components/icons';
import { useAgentOrchestration } from '../../../agent/hooks';
import { getBestLanguageData } from '../../../utils/languageData';
import { AgentExecutor, applyAgentEdits } from '../../../agent';
import { applyToolCallsDirect } from '../../../llmTask/toolCalls/toolCallEngine';
import { CRUD_OPTIONS } from '../../../toolCall/apply/types';
import { buildEditCardsFromToolCallMetadata } from '../../../toolCall';

interface AgentPanelProps
{
    projectId: string;
    mode: 'novelEditor' | 'storyObject' | 'outlineManager';
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
    onSubmit: (e: React.FormEvent, input: string) => Promise<void>;
    onStop: () => void;
}

const AgentInputForm: React.FC<AgentInputFormProps> = React.memo(({ projectId, onSubmit, onStop }) => {
    const { t } = useTranslation();
    const input = useAgentUIStore((state) => state.inputByProject[projectId] ?? '');
    const isLoading = useAgentUIStore((state) => state.loadingByProject[projectId] ?? false);
    const setInput = useAgentUIStore((state) => state.setInput);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        onSubmit(e, input);
    }, [onSubmit, input, isLoading]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e as any, input);
        }
    }, [onSubmit, input, isLoading]);

    return (
        <form onSubmit={handleSubmit} className="agent-form">
            <div className="input-group">
                <textarea
                    value={input}
                    onChange={(e) => setInput(projectId, e.target.value)}
                    placeholder={t('agent.enterMessage')}
                    rows={1}
                    className="agent-input"
                    disabled={isLoading}
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
    storedMessage: StoredAgentMessage;
    chatMessage: ChatMessage;
    requestedLanguage: string;
    displayLanguage: string;
    hasRequestedLanguage: boolean;
    fallbackLanguage: string | null;
    sessionError?: string;
}

const AgentPanel: React.FC<AgentPanelProps> = ({
    projectId,
    mode,
}) =>
{
    const { t } = useTranslation();

    // Agent orchestration - all agent logic is handled internally
    const {
        agentHandlers,
        contextIds,
    } = useAgentOrchestration({ projectId, mode });

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
        triggerAutoContinue,
    } = agentHandlers;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isUserNearBottomRef = useRef(true);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
    const contextDropdownRef = useRef<HTMLDivElement>(null);
    const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
    const { convertToDisplayMessage } = useAgentStore();

    // Use shallow selector to combine multiple store reads into one (reduces re-renders)
    const { isLoading, agentVisibleState, editingMessageId, setAgentVisible } = useAgentUIStore(
        useShallow((state) => ({
            isLoading: state.loadingByProject[projectId] ?? false,
            agentVisibleState: state.agentVisibleByProject[projectId] ?? false,
            editingMessageId: state.editingByProject[projectId]?.messageId ?? null,
            setAgentVisible: state.setAgentVisible,
        }))
    );

    // Handle desktop visibility separately to avoid selector side effects
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    const isAgentVisible = isDesktop ? true : agentVisibleState;

    const { getCurrentProject } = useProjectStore();
    const { settings } = useSettingsStore();
    const { showError } = useErrorStore();
    const novelEditorStore = useNovelEditorStore();

    // Check if editor has unsaved changes (only relevant in novelEditor mode)
    const hasUnsavedChanges = mode === 'novelEditor'
        ? novelEditorStore.getHasUnsavedChanges(projectId)
        : false;

    const mainLanguage = settings.mainLanguage;
    const defaultSubLanguage = settings.defaultSubLanguage;

    // Use state selectors for proper Zustand reactivity (re-render when store changes)
    // IMPORTANT: Get agentId from state inside selector, not from closure (avoids stale value)
    const selectedAgentId = useAgentStore((state) => state.selectedAgentByProject[projectId]);
    // Memoize the selector function to avoid creating new function references on each render
    const agentSelector = useMemo(
        () => (state: ReturnType<typeof useAgentStore.getState>) => {
            const agentId = state.selectedAgentByProject[projectId];
            if (!agentId) return undefined;
            return state.agentsByProject[projectId]?.find((a) => a.id === agentId);
        },
        [projectId]
    );
    const selectedAgent = useAgentStore(agentSelector);
    const storedMessages = useMemo(() => selectedAgent?.messages ?? [], [selectedAgent]);

    // Only subscribe to agent sessions for this project (reduces re-renders from other sessions)
    const projectAgentSessions = useLLMSessionStore(
        useShallow((state) => {
            const filtered: Record<string, any> = {};
            for (const [id, session] of Object.entries(state.sessions)) {
                if (session &&
                    session.kind === 'agent' &&
                    (session.input as any)?.projectId === projectId) {
                    filtered[id] = session;
                }
            }
            return filtered;
        })
    );

    const agentSessionByMessageId = useMemo(() => {
        const map: Record<string, any> = {};
        for (const session of Object.values(projectAgentSessions)) {
            if (!session) continue;

            const assistantMessageId = (session.result as any)?.assistantMessageId as string | undefined;
            if (!assistantMessageId) continue;

            const existing = map[assistantMessageId];
            if (!existing || (existing.createdAt ?? 0) < session.createdAt) {
                map[assistantMessageId] = session;
            }
        }
        return map;
    }, [projectAgentSessions]);

    const [translatingMessages, setTranslatingMessages] = useState<Record<string, boolean>>({});
    const [translationErrors, setTranslationErrors] = useState<Record<string, string | null>>({});
    const [translationSessionByMessageId, setTranslationSessionByMessageId] = useState<Record<string, string>>({});

    // Track translation session statuses - use a stable selector to avoid infinite loops
    const translationSessionIds = useMemo(
        () => Object.values(translationSessionByMessageId),
        [translationSessionByMessageId]
    );
    const translationSessionStatusesSelector = useMemo(
        () => (state: ReturnType<typeof useLLMSessionStore.getState>) => {
            const statuses: Record<string, string | undefined> = {};
            for (const sessionId of translationSessionIds) {
                statuses[sessionId] = state.sessions[sessionId]?.status;
            }
            return statuses;
        },
        [translationSessionIds]
    );
    const translationSessionStatuses = useLLMSessionStore(useShallow(translationSessionStatusesSelector));
    // Per-message language view: tracks which messages are showing translation
    const [messageLanguageView, setMessageLanguageView] = useState<Record<string, 'primary' | 'secondary'>>({});
    const [applyingMessageEdits, setApplyingMessageEdits] = useState<Record<string, boolean>>({});
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
    }, [storedMessages, isLoading]);

    // Hide scroll button when streaming stops
    useEffect(() => {
        if (!isLoading) {
            setShowScrollButton(false);
        }
    }, [isLoading]);


    const resolveDisplayInfo = useCallback(
        (message: StoredAgentMessage): DisplayMessageInfo =>
        {
            // Check per-message language preference
            const messageView = messageLanguageView[message.id];
            const wantsTranslation = Boolean(messageView === 'secondary' && defaultSubLanguage);
            const requestedLanguage = wantsTranslation && defaultSubLanguage ? defaultSubLanguage : mainLanguage;
            const hasRequestedLanguage = Boolean(requestedLanguage && message.data[requestedLanguage]);

            // Check for streaming content from llmTaskStore (takes priority during active streaming)
            const agentSession = agentSessionByMessageId[message.id];
            const streaming = agentSession?.status === 'running'
                ? { contentParts: agentSession.contentParts, thinkingDetails: agentSession.thinkingDetails }
                : undefined;
            const sessionError = agentSession?.status === 'error' ? agentSession.error : undefined;

            if (hasRequestedLanguage)
            {
                const baseChatMessage = convertToDisplayMessage(message, requestedLanguage);
                // Override with streaming content if available
                const chatMessage = streaming
                    ? { ...baseChatMessage, contentParts: streaming.contentParts, thinking_details: streaming.thinkingDetails }
                    : baseChatMessage;

                return {
                    storedMessage: message,
                    chatMessage,
                    requestedLanguage,
                    displayLanguage: requestedLanguage,
                    hasRequestedLanguage: true,
                    fallbackLanguage: null,
                    sessionError,
                };
            }

            const fallback = getBestLanguageData(
                message.data,
                mainLanguage,
                defaultSubLanguage ?? undefined
            );

            const displayLanguage = fallback?.language ?? requestedLanguage ?? mainLanguage;
            const fallbackLanguage = fallback ? fallback.language : null;
            const baseChatMessage = convertToDisplayMessage(message, displayLanguage);
            // Override with streaming content if available
            const chatMessage = streaming
                ? { ...baseChatMessage, contentParts: streaming.contentParts, thinking_details: streaming.thinkingDetails }
                : baseChatMessage;

            return {
                storedMessage: message,
                chatMessage,
                requestedLanguage,
                displayLanguage,
                hasRequestedLanguage: false,
                fallbackLanguage,
                sessionError,
            };
        },
        [messageLanguageView, mainLanguage, defaultSubLanguage, convertToDisplayMessage, agentSessionByMessageId]
    );

    const displayMessages = useMemo(
        () => storedMessages.map(resolveDisplayInfo),
        [storedMessages, resolveDisplayInfo]
    );

    useEffect(() => {
        const entries = Object.entries(translationSessionByMessageId);
        if (entries.length === 0) return;

        // Use getState() for translation session tracking to avoid subscribing to all sessions
        const allSessions = useLLMSessionStore.getState().sessions;
        const finished: Array<{ messageId: string; sessionId: string; status: string; error?: string }> = [];
        for (const [messageId, sessionId] of entries) {
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
    }, [translationSessionByMessageId, translationSessionStatuses, showError]);

    const translateMessage = async (message: StoredAgentMessage) =>
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
        const sourceEntry = message.data[preferredSourceLanguage]
            ? { language: preferredSourceLanguage, data: message.data[preferredSourceLanguage] }
            : getBestLanguageData(message.data, preferredSourceLanguage);

        if (!sourceEntry)
        {
            showError('Translation Failed', `No content available to translate.`);
            return;
        }

        const sourceLanguage = sourceEntry.language;
        const contentParts = (sourceEntry.data as any)?.contentParts ?? [];
        const { content: sourceContent } = collapseContentParts(contentParts);

        if (!sourceContent.trim())
        {
            showError('Translation Failed', `No ${sourceLanguage} content available to translate.`);
            return;
        }

        setTranslatingMessages(prev => ({ ...prev, [message.id]: true }));
        setTranslationErrors(prev => ({ ...prev, [message.id]: null }));

        // Use AgentExecutor directly for translation
        void AgentExecutor.translate({
            projectId,
            agentId: selectedAgentId,
            messageId: message.id,
            sourceLanguage,
            targetLanguage,
            sourceContent,
            originalContentParts: contentParts as any,
        }).then((sessionId) => {
            setTranslationSessionByMessageId(prev => ({ ...prev, [message.id]: sessionId }));
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
                {isLoading &&
                    message.chatMessage.role === 'assistant' &&
                    message === displayMessages[displayMessages.length - 1] && (
                        <div className="typing-indicator inline">
                            <div className="loading-track">
                                <div className="loading-bar" />
                            </div>
                        </div>
                    )}
                {message.sessionError && (
                    <div className="message-error">
                        {message.sessionError}
                    </div>
                )}
            </div>
        );
    };

    const translationEnabled = Boolean(defaultSubLanguage && defaultSubLanguage !== mainLanguage);
    const translationTargetLabel = defaultSubLanguage || 'secondary language';

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
                    const processingResult = displayProcessor.process(message.chatMessage as any, { projectId, mode } as any);
                    const isTranslating = Boolean(translatingMessages[message.storedMessage.id]);
                    const primaryMessage = message.storedMessage.data[mainLanguage]
                        ? convertToDisplayMessage(message.storedMessage, mainLanguage)
                        : message.chatMessage;
                    const { content: primaryPlainContent } = collapseContentParts(primaryMessage.contentParts);
                    const translationAvailable = defaultSubLanguage ? Boolean(message.storedMessage.data[defaultSubLanguage]) : false;
                    const translateButtonLabel = translationAvailable
                        ? t('agent.refreshTranslation', { language: translationTargetLabel })
                        : t('agent.translateTo', { language: translationTargetLabel });
                    const translateDisabled = !translationEnabled || isTranslating;
                    const agentSession = agentSessionByMessageId[message.chatMessage.id];
                    const hasStreamingCalls = Boolean(
                        agentSession &&
                        agentSession.status === 'running' &&
                        agentSession.toolCallProgress?.length > 0
                    );
                    const sessionCards = agentSession?.editCards;
                    const hasSessionCards = Boolean(sessionCards && sessionCards.length > 0);
                    const storedToolCalls = message.storedMessage.toolCalls ?? [];
                    const fallbackCards = !hasSessionCards && storedToolCalls.length > 0
                        ? buildEditCardsFromToolCallMetadata(storedToolCalls)
                        : [];
                    const cardsToRender = (hasSessionCards ? sessionCards : fallbackCards) ?? [];
                    const hasEditCards = cardsToRender.length > 0;
                    const isApplying = agentSession?.status === 'applying' || applyingMessageEdits[message.chatMessage.id] === true;
                    const hasPendingCards = cardsToRender.some((card: any) => card.toolCall.status === 'pending' || card.toolCall.status === 'validating');
                    const cardMode = hasSessionCards
                        ? (agentSession?.status === 'pending_confirmation' || isApplying || hasPendingCards ? 'pending' : 'confirmed')
                        : (hasPendingCards || isApplying ? 'pending' : 'confirmed');

                    return (
                        <div
                            key={message.chatMessage.id}
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
                                                        isStreaming={isLoading && message.chatMessage.id === storedMessages[storedMessages.length - 1]?.id}
                                                    />
                                                )}
                                                {renderMessageContent(message, processingResult)}
                                        {hasStreamingCalls && (
                                            <div className="message-edit-cards">
                                                <ToolCallCard
                                                    mode="streaming"
                                                    streamingProgress={agentSession.toolCallProgress}
                                                    projectId={projectId}
                                                />
                                            </div>
                                        )}

                                        {hasEditCards && (
                                            <div className="message-edit-cards">
                                                <ToolCallCard
                                                    mode={cardMode as any}
                                                    cards={cardsToRender as any}
                                                    onConfirm={
                                                        cardMode === 'pending'
                                                            ? async (selections: Record<string, boolean>) => {
                                                                if (hasUnsavedChanges) {
                                                                    showError('Cannot Apply', 'Save your changes first - unsaved work will be overwritten.');
                                                                    return;
                                                                }

                                                                if (hasSessionCards && agentSession) {
                                                                    await applyAgentEdits({
                                                                        sessionId: agentSession.id,
                                                                        projectId,
                                                                        language: mainLanguage,
                                                                        selections,
                                                                        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                    });
                                                                    // Auto-continue: trigger next LLM turn with tool results
                                                                    await triggerAutoContinue();
                                                                    return;
                                                                }

                                                                if (!selectedAgentId || storedToolCalls.length === 0) return;

                                                                setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: true }));
                                                                try {
                                                                    const nextToolCalls = await applyToolCallsDirect({
                                                                        projectId,
                                                                        language: mainLanguage,
                                                                        toolCalls: storedToolCalls,
                                                                        selections,
                                                                        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                    });

                                                                    await useAgentStore.getState().updateMessageToolCalls(
                                                                        projectId,
                                                                        selectedAgentId,
                                                                        message.chatMessage.id,
                                                                        nextToolCalls
                                                                    );
                                                                } finally {
                                                                    setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: false }));
                                                                }
                                                                // Auto-continue: trigger next LLM turn with tool results
                                                                await triggerAutoContinue();
                                                            }
                                                            : undefined
                                                    }
                                                    onConfirmAndPause={
                                                        cardMode === 'pending'
                                                            ? async (selections: Record<string, boolean>) => {
                                                                if (hasUnsavedChanges) {
                                                                    showError('Cannot Apply', 'Save your changes first - unsaved work will be overwritten.');
                                                                    return;
                                                                }

                                                                if (hasSessionCards && agentSession) {
                                                                    await applyAgentEdits({
                                                                        sessionId: agentSession.id,
                                                                        projectId,
                                                                        language: mainLanguage,
                                                                        selections,
                                                                        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                    });
                                                                    return;
                                                                }

                                                                if (!selectedAgentId || storedToolCalls.length === 0) return;

                                                                setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: true }));
                                                                try {
                                                                    const nextToolCalls = await applyToolCallsDirect({
                                                                        projectId,
                                                                        language: mainLanguage,
                                                                        toolCalls: storedToolCalls,
                                                                        selections,
                                                                        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                    });

                                                                    await useAgentStore.getState().updateMessageToolCalls(
                                                                        projectId,
                                                                        selectedAgentId,
                                                                        message.chatMessage.id,
                                                                        nextToolCalls
                                                                    );
                                                                } finally {
                                                                    setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: false }));
                                                                }
                                                            }
                                                            : undefined
                                                    }
                                                    projectId={projectId}
                                                    isApplyDisabled={hasUnsavedChanges || isApplying}
                                                    applyDisabledReason={
                                                        hasUnsavedChanges
                                                            ? 'Save your changes first - unsaved work will be overwritten'
                                                            : isApplying
                                                                ? 'Applying changes...'
                                                                : undefined
                                                    }
                                                />
                                            </div>
                                        )}
                                                                                <div className="message-actions">
                                            {translationErrors[message.storedMessage.id] && (
                                                <div className="translation-error">{translationErrors[message.storedMessage.id]}</div>
                                            )}
                                            <div className="action-buttons">
                                                {/* Per-message language toggle - only show when translation exists */}
                                                {translationAvailable && (
                                                    <IconButton
                                                        icon={<Globe size="xs" />}
                                                        variant="ghost"
                                                        size="xs"
                                                        isActive={messageLanguageView[message.storedMessage.id] === 'secondary'}
                                                        onClick={() => setMessageLanguageView(prev => ({
                                                            ...prev,
                                                            [message.storedMessage.id]: prev[message.storedMessage.id] === 'secondary' ? 'primary' : 'secondary'
                                                        }))}
                                                        title={messageLanguageView[message.storedMessage.id] === 'secondary'
                                                            ? t('agent.switchToLanguage', { language: mainLanguage })
                                                            : t('agent.switchToLanguage', { language: defaultSubLanguage })
                                                        }
                                                    />
                                                )}
                                                {translationEnabled && (
                                                    <IconButton
                                                        icon={isTranslating ? <CircularArrow size="xs" /> : translationAvailable ? <CircularArrow size="xs" /> : <Globe size="xs" />}
                                                        onClick={() => translateMessage(message.storedMessage)}
                                                        disabled={translateDisabled}
                                                        title={translateButtonLabel}
                                                        variant="ghost"
                                                        size="xs"
                                                    />
                                                )}
                                                <IconButton
                                                    icon={<Edit size="xs" />}
                                                    onClick={() => {
                                                        // Switch to primary view for this message when editing
                                                        setMessageLanguageView(prev => ({
                                                            ...prev,
                                                            [message.storedMessage.id]: 'primary'
                                                        }));
                                                        onEditMessage(message.chatMessage.id, primaryPlainContent, mainLanguage);
                                                    }}
                                                    disabled={isTranslating || !primaryPlainContent.trim()}
                                                    title={t('agent.edit')}
                                                    variant="ghost"
                                                    size="xs"
                                                />
                                                <IconButton
                                                    icon={<Trash size="xs" />}
                                                    onClick={() => onDeleteMessage(message.chatMessage.id)}
                                                    disabled={isTranslating}
                                                    title={t('agent.delete')}
                                                    variant="ghost"
                                                    size="xs"
                                                    className="icon-button--ghost-danger"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}

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
                    <AgentModeToggle
                        currentMode={mode}
                        onModeChange={(newMode) => useAgentUIStore.getState().setMode(projectId, newMode)}
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
                    onSubmit={onSubmit}
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
