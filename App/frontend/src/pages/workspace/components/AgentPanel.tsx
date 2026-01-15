import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
import AgentSidebar from '../../../components/AgentSidebar';
import { DefaultDisplayProcessor } from '../../../agent/processors/DisplayProcessor';
import type { ChatMessage } from '../../../llm/requestTypes';
import ThinkingDisplay from '../../../components/ThinkingDisplay';
import { FunctionCallCard } from '../../../components/functionCall';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import { collapseContentParts } from '../../../agent/utils/contentParts';
import { Settings, Edit, Trash, Globe, CircularArrow, ChevronUp, ChevronDown } from '../../../components/icons';
import { useAgentOrchestration } from '../../../agent/hooks';
import { getBestLanguageData } from '../../../utils/languageData';
import { AgentExecutor } from '../../../agent';
import { applyFunctionCallsDirect, applySessionEdits } from '../../../llmTask/functionCalls/functionCallEngine';
import { CRUD_OPTIONS } from '../../../functionCall/applicator/types';
import { buildEditCardsFromFunctionCallMetadata } from '../../../functionCall';

interface AgentPanelProps
{
    projectId: string;
    mode: 'novelEditor' | 'storyObject' | 'outlineManager';
}

// Context picker component for selecting which objects to include in agent context
interface AgentContextPickerProps {
    projectId: string;
    language: string;
    selectedIds: string[];
    totalCount: number;
    onChange: (ids: string[]) => void;
}

const AgentContextPicker: React.FC<AgentContextPickerProps> = React.memo(({
    projectId,
    language,
    selectedIds,
    totalCount,
    onChange
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    return (
        <div className={`agent-controls ${isCollapsed ? 'collapsed' : 'expanded'}`}>
            <div className="agent-controls-header" onClick={() => setIsCollapsed(!isCollapsed)}>
                <span className="agent-controls-title">
                    <Settings size="sm" /> Context ({selectedIds.length}/{totalCount})
                </span>
                <button
                    type="button"
                    className="agent-controls-toggle"
                    aria-label={isCollapsed ? "Expand context picker" : "Collapse context picker"}
                >
                    {isCollapsed ? <ChevronUp size="xs" /> : <ChevronDown size="xs" />}
                </button>
            </div>
            <div className="agent-controls-content">
                <div className="agent-controls-content-inner">
                    <ObjectPicker
                        mode="all"
                        selectionMode="multi"
                        selectedIds={selectedIds}
                        onChange={(ids) => onChange(ids as string[])}
                        projectId={projectId}
                        language={language}
                        maxHeight="300px"
                        showSearch={true}
                        selectAllOnLoad={true}
                    />
                </div>
            </div>
        </div>
    );
});

// Separate component for input form to avoid re-rendering messages on typing
interface AgentInputFormProps {
    projectId: string;
    mainLanguage: string;
    onSubmit: (e: React.FormEvent, input: string) => Promise<void>;
    onStop: () => void;
}

const AgentInputForm: React.FC<AgentInputFormProps> = React.memo(({ projectId, mainLanguage, onSubmit, onStop }) => {
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
                    placeholder={`Enter a message in ${mainLanguage}...`}
                    rows={1}
                    className="agent-input"
                    disabled={isLoading}
                    onKeyDown={handleKeyDown}
                />
                {isLoading ? (
                    <TextButton key="stop" type="button" variant="danger" onClick={onStop} className="agent-submit-btn">
                        Stop
                    </TextButton>
                ) : (
                    <TextButton key="send" type="submit" variant="primary" className="agent-submit-btn">
                        Send
                    </TextButton>
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
    const editingContent = useAgentUIStore((state) => state.editingByProject[projectId]?.content ?? '');

    return (
        <div className="message-edit">
            <textarea
                ref={editTextareaRef}
                value={editingContent}
                onChange={onEditContentChange}
                placeholder="Edit content"
            />
            <div className="edit-actions">
                <TextButton
                    variant="primary"
                    size="sm"
                    onClick={onSaveEdit}
                >
                    Save
                </TextButton>
                <TextButton variant="secondary" size="sm" onClick={onCancelEdit}>Cancel</TextButton>
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
}

const AgentPanel: React.FC<AgentPanelProps> = ({
    projectId,
    mode,
}) =>
{
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
    } = agentHandlers;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isUserNearBottomRef = useRef(true);
    const [showScrollButton, setShowScrollButton] = useState(false);
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
    const llmSessions = useLLMSessionStore((state) => state.sessions);
    const agentSessionByMessageId = useMemo(() => {
        const map: Record<string, any> = {};
        for (const session of Object.values(llmSessions)) {
            if (!session) continue;
            if (session.kind !== 'agent') continue;
            if ((session.input as any)?.projectId !== projectId) continue;

            const assistantMessageId = (session.result as any)?.assistantMessageId as string | undefined;
            if (!assistantMessageId) continue;

            const existing = map[assistantMessageId];
            if (!existing || (existing.createdAt ?? 0) < session.createdAt) {
                map[assistantMessageId] = session;
            }
        }
        return map;
    }, [llmSessions, projectId]);

    const [translatingMessages, setTranslatingMessages] = useState<Record<string, boolean>>({});
    const [translationErrors, setTranslationErrors] = useState<Record<string, string | null>>({});
    const [translationSessionByMessageId, setTranslationSessionByMessageId] = useState<Record<string, string>>({});
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
                    fallbackLanguage: null
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
                fallbackLanguage
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

        const finished: Array<{ messageId: string; sessionId: string; status: string; error?: string }> = [];
        for (const [messageId, sessionId] of entries) {
            const session = llmSessions[sessionId];
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
    }, [translationSessionByMessageId, llmSessions, showError]);

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
        // Extract error parts from contentParts
        const errorParts = message.chatMessage.contentParts?.filter(
            (part: any) => part.type === 'error'
        ) || [];

        return (
            <div className="message-content">
                {!message.hasRequestedLanguage && (
                    <div className="language-fallback-badge">
                        Using {message.fallbackLanguage || message.displayLanguage}
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
                {errorParts.map((errorPart: any, index: number) => (
                    <div key={`error-${index}`} className="message-error">
                        {errorPart.text}
                    </div>
                ))}
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
                        title="View agent list"
                    >
                        Agents
                    </TextButton>
                    <h2>{selectedAgent?.name || 'AI Agent'}</h2>
                </div>
                <TextButton
                    variant="secondary"
                    size="sm"
                    className="mobile-only"
                    onClick={() => setAgentVisible(projectId, false)}
                >
                    Close
                </TextButton>
            </div>

            <div className="agent-messages" ref={scrollContainerRef}>
                {displayMessages.length === 0 && (
                    <div className="welcome-message">
                        <div className="ai-avatar">AI</div>
                        <div className="message-content">
                            <p>Hello! I am here to help with your novel writing.</p>
                            {currentProject && (
                                <p>{`What can I help you with for the "${currentProject.name}" project?`}</p>
                            )}
                        </div>
                    </div>
                )}

                {displayMessages.map((message) =>
                {
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
                        ? `Refresh ${translationTargetLabel}`
                        : `Translate to ${translationTargetLabel}`;
                    const translateDisabled = !translationEnabled || isTranslating;
                    const agentSession = agentSessionByMessageId[message.chatMessage.id];
                    const hasStreamingCalls = Boolean(
                        agentSession &&
                        agentSession.status === 'running' &&
                        agentSession.functionCallProgress?.length > 0
                    );
                    const sessionCards = agentSession?.editCards;
                    const hasSessionCards = Boolean(sessionCards && sessionCards.length > 0);
                    const storedFunctionCalls = message.storedMessage.functionCalls ?? [];
                    const fallbackCards = !hasSessionCards && storedFunctionCalls.length > 0
                        ? buildEditCardsFromFunctionCallMetadata(storedFunctionCalls)
                        : [];
                    const cardsToRender = (hasSessionCards ? sessionCards : fallbackCards) ?? [];
                    const hasEditCards = cardsToRender.length > 0;
                    const isApplying = agentSession?.status === 'applying' || applyingMessageEdits[message.chatMessage.id] === true;
                    const hasPendingCards = cardsToRender.some((card: any) => card.functionCall.status === 'pending' || card.functionCall.status === 'validating');
                    const cardMode = hasSessionCards
                        ? (agentSession?.status === 'pending_confirmation' || isApplying || hasPendingCards ? 'pending' : 'confirmed')
                        : (hasPendingCards || isApplying ? 'pending' : 'confirmed');

                    return (
                        <div
                            key={message.chatMessage.id}
                            className={`agent-message ${message.chatMessage.role}${isEditing ? ' editing' : ''}`}
                        >
                            {/* Show thinking above the message bubble */}
                            {message.chatMessage.role === 'assistant' && (
                                <ThinkingDisplay
                                    messageId={message.chatMessage.id}
                                    contentParts={message.chatMessage.contentParts}
                                    isStreaming={isLoading && message.chatMessage.id === storedMessages[storedMessages.length - 1]?.id}
                                />
                            )}

                            <div className="message-wrapper">
                                <div className="message-header">
                                    <span className="message-role">{isUser ? 'You' : 'AI'}</span>
                                    <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                                </div>

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
                                                {renderMessageContent(message, processingResult)}
                                        {hasStreamingCalls && (
                                            <div className="message-edit-cards">
                                                <FunctionCallCard
                                                    mode="streaming"
                                                    streamingProgress={agentSession.functionCallProgress}
                                                    projectId={projectId}
                                                />
                                            </div>
                                        )}

                                        {hasEditCards && (
                                            <div className="message-edit-cards">
                                                <FunctionCallCard
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
                                                                    await applySessionEdits({
                                                                        sessionId: agentSession.id,
                                                                        projectId,
                                                                        language: mainLanguage,
                                                                        selections,
                                                                        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                    });
                                                                    return;
                                                                }

                                                                if (!selectedAgentId || storedFunctionCalls.length === 0) return;

                                                                setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: true }));
                                                                try {
                                                                    const nextFunctionCalls = await applyFunctionCallsDirect({
                                                                        projectId,
                                                                        language: mainLanguage,
                                                                        functionCalls: storedFunctionCalls,
                                                                        selections,
                                                                        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                    });

                                                                    await useAgentStore.getState().updateMessageFunctionCalls(
                                                                        projectId,
                                                                        selectedAgentId,
                                                                        message.chatMessage.id,
                                                                        nextFunctionCalls
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
                                                    <TextButton
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setMessageLanguageView(prev => ({
                                                            ...prev,
                                                            [message.storedMessage.id]: prev[message.storedMessage.id] === 'secondary' ? 'primary' : 'secondary'
                                                        }))}
                                                        title={messageLanguageView[message.storedMessage.id] === 'secondary'
                                                            ? `Switch to ${mainLanguage}`
                                                            : `Switch to ${defaultSubLanguage}`
                                                        }
                                                    >
                                                        {messageLanguageView[message.storedMessage.id] === 'secondary'
                                                            ? defaultSubLanguage?.slice(0, 2).toUpperCase()
                                                            : mainLanguage?.slice(0, 2).toUpperCase()
                                                        }
                                                    </TextButton>
                                                )}
                                                {translationEnabled && (
                                                    <IconButton
                                                        icon={isTranslating ? <CircularArrow size="sm" /> : translationAvailable ? <CircularArrow size="sm" /> : <Globe size="sm" />}
                                                        onClick={() => translateMessage(message.storedMessage)}
                                                        disabled={translateDisabled}
                                                        title={translateButtonLabel}
                                                        size="sm"
                                                    />
                                                )}
                                                <IconButton
                                                    icon={<Edit size="sm" />}
                                                    onClick={() => {
                                                        // Switch to primary view for this message when editing
                                                        setMessageLanguageView(prev => ({
                                                            ...prev,
                                                            [message.storedMessage.id]: 'primary'
                                                        }));
                                                        onEditMessage(message.chatMessage.id, primaryPlainContent, mainLanguage);
                                                    }}
                                                    disabled={isTranslating || !primaryPlainContent.trim()}
                                                    title="Edit"
                                                    size="sm"
                                                />
                                                <IconButton
                                                    icon={<Trash size="sm" />}
                                                    onClick={() => onDeleteMessage(message.chatMessage.id)}
                                                    disabled={isTranslating}
                                                    title="Delete"
                                                    size="sm"
                                                    variant="danger"
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
                        title="Scroll to bottom"
                        variant="primary"
                    />
                )}
            </div>

            <div className="agent-input-container">
                <AgentContextPicker
                    projectId={projectId}
                    language={mainLanguage}
                    selectedIds={selectedContextIds}
                    totalCount={totalObjectCount}
                    onChange={onContextIdsChange}
                />
                <AgentInputForm
                    projectId={projectId}
                    mainLanguage={mainLanguage}
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
