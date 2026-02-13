import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type StoredAgentMessage } from '../../../store/agentStore';
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
import type { ChatMessage } from '../../../llm/requestTypes';
import ThinkingDisplay from '../../../components/common/ThinkingDisplay';
import { FunctionCallsThread } from '../../../toolCall/ui';
import { SubAgentPeekDock } from '../../../components/SubAgentPeek';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import AgentRunModeToggle from '../../../components/ui/AgentRunModeToggle';
import { collapseContentParts } from '../../../agent/utils/contentParts';
import { Settings, Edit, Trash, Globe, CircularArrow, ChevronDown, Send, Stop } from '../../../components/icons';
import { useAgentOrchestration } from '../../../agent/hooks';
import { getBestLanguageData } from '../../../utils/languageData';
import { AgentExecutor, executeAgentToolCalls } from '../../../agent';
import { CRUD_OPTIONS } from '../../../toolCall/apply/types';
import { buildEditCardsFromToolCallMetadata } from '../../../toolCall';
import type { ToolCallDecisionMap } from '../../../toolCall/types';
import type { AgentRunMode, WorkspaceSurface } from '../../../types/agentRuntime';
import { subAgentRunService } from '../../../api/subAgentRunService';
import { buildSubAgentRunKey, useSubAgentRuntimeStore } from '../../../store/subAgentRuntimeStore';
import { mapPersistedMessagesToHistory, buildIdMapFromServerMessages } from '../../../subAgent/runtime/SubAgentManager';
import { SubAgentManager } from '../../../subAgent/runtime/SubAgentManager';
import { getSendBlockingState } from '../../../toolCall/viewModel/blockingSelectors';

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
    const archiveBoundaryId = selectedAgent?.archived_until_message_id ?? null;

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
    const runsByKey = useSubAgentRuntimeStore((state) => state.runsByKey);

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
    const translationSessionByMessageIdRef = useRef(translationSessionByMessageId);
    useEffect(() => {
        translationSessionByMessageIdRef.current = translationSessionByMessageId;
    }, [translationSessionByMessageId]);

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

            // Check for streaming content from llmSession (takes priority during active streaming)
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

    const lastAssistantMessageId = useMemo(() => {
        for (let i = storedMessages.length - 1; i >= 0; i--) {
            if (storedMessages[i]?.role === 'assistant') {
                return String(storedMessages[i].id);
            }
        }
        return null;
    }, [storedMessages]);

    const sendBlockingState = useMemo(
        () =>
            getSendBlockingState({
                selectedAgentId,
                messages: storedMessages,
                sessions: Object.values(projectAgentSessions),
                runsByKey,
            }),
        [selectedAgentId, storedMessages, projectAgentSessions, runsByKey]
    );

    const sendBlockedReason = useMemo(() => {
        if (!sendBlockingState.blocked) return null;
        if (sendBlockingState.unresolvedToolCalls.count > 0) {
            return `Resolve ${sendBlockingState.unresolvedToolCalls.count} pending operation(s) before sending.`;
        }
        if (sendBlockingState.rootSessionBlocked) {
            return 'The agent is still running or applying operations.';
        }
        return 'Resolve pending operations before sending.';
    }, [sendBlockingState]);

    const subAgentRootMessageIds = useMemo(() => {
        return storedMessages
            .filter((msg) =>
                msg.role === 'assistant' &&
                Array.isArray(msg.toolCalls) &&
                msg.toolCalls.some((tc: any) => typeof tc?.tool_name === 'string' && tc.tool_name.startsWith('call_'))
            )
            .map((msg) => msg.id);
    }, [storedMessages]);

    const subAgentRootMessageKey = useMemo(
        () => [...subAgentRootMessageIds].sort().join('|'),
        [subAgentRootMessageIds]
    );

    useEffect(() => {
        if (!projectId || !selectedAgentId) return;
        if (subAgentRootMessageIds.length === 0) return;

        let cancelled = false;
        const navigationEntry =
            typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
                ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
                : undefined;
        const legacyNavigationType = typeof performance !== 'undefined' ? (performance as any)?.navigation?.type : undefined;
        const isReloadNavigation = navigationEntry?.type === 'reload' || legacyNavigationType === 1;

        void subAgentRunService
            .queryByMessages(projectId, selectedAgentId, {
                message_ids: subAgentRootMessageIds,
                status_filter: ['running', 'waiting', 'paused', 'completed', 'error', 'cancelled'],
            })
            .then(async (response) => {
                if (cancelled) return;
                const runtime = useSubAgentRuntimeStore.getState();
                const interruptionMessage = t('subAgent.interruptedAfterRefresh');
                const interruptedPatches: Promise<unknown>[] = [];
                const parentReconciliations: Promise<unknown>[] = [];

                for (const item of response.items ?? []) {
                    if (cancelled) return;
                    const runKey = buildSubAgentRunKey({
                        parentType: item.parent_type as any,
                        parentId: item.parent_id,
                        parentMessageId: item.parent_message_id,
                        parentToolCallId: item.parent_tool_call_id,
                    });
                    const localRun = runtime.getRunByKey(runKey);
                    const history = mapPersistedMessagesToHistory(item.messages ?? []);
                    const messageIdMap = buildIdMapFromServerMessages(item.messages ?? []);

                    const caller =
                        item.caller === 'planMode' || item.caller === 'agentMode' || item.caller === 'subAgent'
                            ? item.caller
                            : 'subAgent';
                    const wasInterrupted =
                        !localRun &&
                        isReloadNavigation &&
                        (item.status === 'running' || item.status === 'waiting');
                    const restoredStatus = wasInterrupted ? 'paused' : item.status;
                    const restoredError = wasInterrupted ? interruptionMessage : (item.error ?? undefined);

                    if (!localRun) {
                        runtime.upsertRun({
                            id: item.id,
                            persistentId: item.id,
                            parentType: item.parent_type as any,
                            parentId: item.parent_id,
                            parentMessageId: item.parent_message_id,
                            parentToolCallId: item.parent_tool_call_id,
                            projectId: item.project_id,
                            agentId: item.agent_id,
                            language: item.language,
                            caller,
                            agentName: item.agent_name,
                            subAgentId: item.sub_agent_id,
                            displayName: item.display_name,
                            input: item.input ?? '',
                            status: restoredStatus as any,
                            history,
                            turnCount: 0,
                            messageIdMap,
                            activeSessionId: null,
                            finalOutput: item.final_output ?? undefined,
                            error: restoredError,
                        });
                    }

                    if (wasInterrupted) {
                        interruptedPatches.push(
                            subAgentRunService.patchRun(projectId, selectedAgentId, item.id, {
                                status: 'paused',
                                error: interruptionMessage,
                            })
                            .catch((error) => {
                                console.error('Failed to persist interrupted Sub Agent run:', error);
                            })
                        );
                    }

                    parentReconciliations.push(
                        SubAgentManager.reconcileParentToolCall(runKey).catch((error) => {
                            console.error('Failed to reconcile parent Sub Agent tool call state:', error);
                        })
                    );
                }

                if (interruptedPatches.length > 0 || parentReconciliations.length > 0) {
                    await Promise.all([...interruptedPatches, ...parentReconciliations]);
                }
            })
            .catch((error) => {
                console.error('Failed to restore Sub Agent runs:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [projectId, selectedAgentId, subAgentRootMessageIds, subAgentRootMessageKey, t]);

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
                    const storedToolCalls = message.storedMessage.toolCalls ?? [];
                    const cardsToRender = storedToolCalls.length > 0
                        ? buildEditCardsFromToolCallMetadata(storedToolCalls)
                        : [];
                    const hasEditCards = cardsToRender.length > 0;
                    const isApplying = applyingMessageEdits[message.chatMessage.id] === true;
                    const hasPendingCards = storedToolCalls.some((toolCall: any) => {
                        const status = String(toolCall?.status ?? 'pending');
                        return status === 'pending' || status === 'validating' || status === 'processing' || status === 'running';
                    });
                    const cardMode = hasPendingCards || isApplying ? 'pending' : 'confirmed';
                    const functionThreadId = `agent:${selectedAgentId ?? 'none'}:${message.chatMessage.id}`;
                    const subAgentToolCallIds = cardsToRender
                        .filter((card: any) => typeof card?.toolCall?.toolName === 'string' && card.toolCall.toolName.startsWith('call_'))
                        .map((card: any) => card.toolCall.id);
                    const hasSubAgentCalls = subAgentToolCallIds.length > 0;
                    const isActiveSubAgentParent = message.chatMessage.id === lastAssistantMessageId;

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
                                                        isStreaming={isLoading && message.chatMessage.id === storedMessages[storedMessages.length - 1]?.id}
                                                    />
                                                )}
                                                {renderMessageContent(message, processingResult)}
                                                {hasStreamingCalls && (
                                                    <div
                                                        className="message-function-calls"
                                                        data-function-call-message-id={message.chatMessage.id}
                                                    >
                                                        <FunctionCallsThread
                                                            threadId={`${functionThreadId}:stream`}
                                                            mode="streaming"
                                                            streamingProgress={agentSession.toolCallProgress}
                                                            projectId={projectId}
                                                        />
                                                    </div>
                                                )}

                                                {hasEditCards && (
                                                    <div
                                                        className="message-function-calls"
                                                        data-function-call-message-id={message.chatMessage.id}
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

                                                                        if (!selectedAgentId || storedToolCalls.length === 0) return;

                                                                        setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: true }));
                                                                        try {
                                                                            const result = await executeAgentToolCalls({
                                                                                projectId,
                                                                                agentId: selectedAgentId,
                                                                                assistantMessageId: message.chatMessage.id,
                                                                                language: mainLanguage,
                                                                                decisions,
                                                                                options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                                invocationCaller: runMode,
                                                                            });
                                                                            if (result.shouldAutoContinue) {
                                                                                await triggerAutoContinue();
                                                                            }
                                                                        } finally {
                                                                            setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: false }));
                                                                        }
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

                                                                        if (!selectedAgentId || storedToolCalls.length === 0) return;

                                                                        setApplyingMessageEdits((prev) => ({ ...prev, [message.chatMessage.id]: true }));
                                                                        try {
                                                                            await executeAgentToolCalls({
                                                                                projectId,
                                                                                agentId: selectedAgentId,
                                                                                assistantMessageId: message.chatMessage.id,
                                                                                language: mainLanguage,
                                                                                decisions,
                                                                                options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
                                                                                invocationCaller: runMode,
                                                                            });
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
                                                        icon={<Globe size="sm" />}
                                                        variant="ghost"
                                                        size="sm"
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
                                                        icon={isTranslating ? <CircularArrow size="sm" /> : translationAvailable ? <CircularArrow size="sm" /> : <Globe size="sm" />}
                                                        onClick={() => translateMessage(message.storedMessage)}
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
                                                            [message.storedMessage.id]: 'primary'
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
                                    </>
                                )}
                                </div>
                            </div>

                            {selectedAgentId && hasSubAgentCalls && (
                                <SubAgentPeekDock
                                    threadId={`${functionThreadId}:peek`}
                                    parentType="agent"
                                    parentId={selectedAgentId}
                                    parentMessageId={String(message.chatMessage.id)}
                                    parentToolCallIds={subAgentToolCallIds}
                                    isActiveParent={isActiveSubAgentParent}
                                />
                            )}

                            {archiveBoundaryId === message.chatMessage.id && (
                                <div className="agent-archive-divider" role="separator" aria-label="Memory boundary">
                                    <div className="agent-archive-divider-line" />
                                    <span className="agent-archive-divider-label">Memory boundary</span>
                                    <div className="agent-archive-divider-line" />
                                </div>
                            )}
                        </React.Fragment>
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
