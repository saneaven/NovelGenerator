import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EditCard } from '../chat/types';
import { ChatManager, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { areEditCardMapsEqual } from '../chat/utils/editCardUtils';
import { WORKSPACE_FUNCTIONS } from '../llm/schemas/chatFunctions';
import { useChatStore } from '../store/chatStore';
import { useChatUIStore } from '../store/chatUIStore';
import { useSidebarStore } from '../store/sidebarStore';
import { useProjectStore } from '../store/projectStore';
import { useUnifiedObjectStore, useStoryObjects } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';

import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import TranslationModal from '../components/TranslationModal';
import ChatPanel from './workspace/components/ChatPanel';
import StoryPanel from './workspace/components/StoryPanel';
import WorkspaceTabsSidebar from './workspace/components/WorkspaceTabsSidebar';
import { PageHeader, MobileFooter } from '../components/layout';

import { useWorkspaceState } from './workspace/hooks/useWorkspaceState';
import { useChatHandlers } from './workspace/hooks/useChatHandlers';
import { useFunctionCallHandlers } from './workspace/hooks/useFunctionCallHandlers';
import { BackendError } from '../llm/llmService';

import './Workspace.css';
import './workspace/styles/ChatPanel.css';
import './workspace/styles/ChatHeader.css';
import './workspace/styles/ChatMessages.css';
import './workspace/styles/MessageEdit.css';
import './workspace/styles/ChatInput.css';
import './workspace/styles/ChatSidebar.css';
import './workspace/styles/MessageEditCards.css';
import '../components/MobileChat.css';

// Tab labels for mobile subtitle
const tabLabels: Record<string, string> = {
    basicInfo: 'Basic Info',
    characters: 'Characters',
    organizations: 'Organizations',
    locations: 'Locations',
    lorebook: 'Lorebook',
    outline: 'Outline',
};

const Workspace: React.FC = () =>
{
    const { projectId } = useParams<{ projectId: string }>();

    const { getCurrentProject, fetchProjects, projects, isLoading: projectsLoading } = useProjectStore();
    const {
        addMessage,
        updateMessage,
        updateMessageContentLocal,
        getMessages,
        getSelectedChatId,
        fetchChats,
    } = useChatStore();
    const listObjects = useUnifiedObjectStore(state => state.listObjects);
    const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
    const displayLanguage = useSettingsStore(state => state.settings.displayLanguage);
    const setDisplayLanguage = useSettingsStore(state => state.setDisplayLanguage);
    const chatFunctionConfig = useSettingsStore(state => state.settings.functionConfigs.chat);
    const providerCredentials = useSettingsStore(state => state.settings.providerCredentials);
    const { currentError, showError, hideError } = useErrorStore();
    // Use selectors to avoid re-rendering on input changes
    const isChatVisibleState = useChatUIStore((state) => state.chatVisibleByProject[projectId ?? ''] ?? false);
    const setChatVisible = useChatUIStore((state) => state.setChatVisible);
    const toggleChatVisible = useChatUIStore((state) => state.toggleChatVisible);
    const isDesktopView = typeof window !== 'undefined' && window.innerWidth > 768;
    const isChatVisible = isDesktopView ? true : isChatVisibleState;
    const sidebarStore = useSidebarStore();

    // Force re-render when crossing desktop/mobile breakpoint
    const [_isDesktop, setIsDesktop] = useState(() => window.innerWidth > 768);
    useEffect(() => {
        const handleResize = () => {
            const desktop = window.innerWidth > 768;
            setIsDesktop(prev => {
                if (prev !== desktop) return desktop;
                return prev;
            });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const { state: uiState, actions: uiActions } = useWorkspaceState(projectId);
    const settings = useSettingsStore(state => state.settings);

    // Translation modal state
    const [showTranslateModal, setShowTranslateModal] = useState(false);

    // Mobile chat overlay closing animation state
    const [isOverlayClosing, setIsOverlayClosing] = useState(false);

    const handleCloseChat = useCallback(() => {
        setIsOverlayClosing(true);
        setChatVisible(projectId ?? '', false);
    }, [projectId, setChatVisible]);

    const handleOverlayAnimationEnd = useCallback((e: React.AnimationEvent) => {
        if (e.animationName === 'overlayFadeOut') {
            setChatVisible(projectId ?? '', false);
            setIsOverlayClosing(false);
        }
    }, [projectId, setChatVisible]);
    const unifiedStore = useUnifiedObjectStore();

    // Build available languages list (main + all sub languages)
    const availableLanguages = useMemo(() => {
        const languages = [settings.mainLanguage];
        if (settings.subLanguages && settings.subLanguages.length > 0) {
            languages.push(...settings.subLanguages);
        }
        return languages;
    }, [settings.mainLanguage, settings.subLanguages]);

    // Calculate count of objects needing translation to any sub language
    const objectsNeedingTranslation = useMemo(() => {
        if (!settings.subLanguages || settings.subLanguages.length === 0 || !projectId) return 0;

        const allObjects = Object.values(unifiedStore.objects);
        let count = 0;

        allObjects.forEach((obj: any) => {
            if (obj.metadata?.project_id !== projectId) return;

            // Check if object is missing any sub language translation
            const availableLangs = Object.keys(obj.data || {});
            const needsAnyTranslation = settings.subLanguages.some(
                (subLang: string) => !availableLangs.includes(subLang)
            );

            if (needsAnyTranslation) {
                count++;
            }
        });

        return count;
    }, [unifiedStore.objects, projectId, settings.subLanguages]);

    // Handler for translation complete
    const handleTranslateComplete = () => {
        // Refresh objects after translation
        if (projectId) {
            listObjects('basic_info', projectId);
            listObjects('character', projectId);
            listObjects('organization', projectId);
            listObjects('location', projectId);
            listObjects('lorebook', projectId);
            listObjects('act', projectId);
            listObjects('chapter', projectId);
        }
        setShowTranslateModal(false);
    };

    // Derive story objects reactively from unified store (always uses main language for chat context)
    const storyObjects = useStoryObjects(projectId, mainLanguage);

    // Fetch projects if not loaded
    useEffect(() => {
        if (projectId && projects.length === 0) {
            fetchProjects();
        }
    }, [projectId, projects.length, fetchProjects]);

    // Selected context IDs for chat - initialized with all project objects
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>(() => {
        return Object.keys(unifiedStore.objects)
            .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId);
    });

    // Track previous object IDs to auto-select newly created objects
    const prevObjectIdsRef = useRef<Set<string>>(new Set(selectedContextIds));
    // Ref to always get current selectedContextIds (avoid stale closure in ChatManager)
    const selectedContextIdsRef = useRef(selectedContextIds);
    selectedContextIdsRef.current = selectedContextIds;

    // Auto-select new objects when they're created during the session
    useEffect(() => {
        const currentIds = new Set(
            Object.keys(unifiedStore.objects)
                .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId)
        );

        // Find new IDs that weren't in the previous set
        const newIds = [...currentIds].filter(id => !prevObjectIdsRef.current.has(id));

        if (newIds.length > 0) {
            setSelectedContextIds(prev => [...new Set([...prev, ...newIds])]);
        }

        prevObjectIdsRef.current = currentIds;
    }, [unifiedStore.objects, projectId]);

    // Total count of all project objects for display
    const totalObjectCount = useMemo(() => {
        return Object.keys(unifiedStore.objects)
            .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId)
            .length;
    }, [unifiedStore.objects, projectId]);

    const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
    const abortControllerRef = useRef<AbortController | null>(null);

    const {
        messageEditCards,
        activeFunctionCalls,
        pendingFunctionCallResults,
        setPendingFunctionCallResults,
        setMessageEditCards,
        handleFunctionCalls,
        handleFunctionCallProgress,
        handleBatchConfirm,
        isMessageConfirmed,
        setConfirmedMessages,
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
        registerSessionForMessage,
    } = useFunctionCallHandlers(projectId);

    const chatManagerCallbacks = useMemo<ChatManagerCallbacks>(() => ({
        onUpdateMessage: (projId, chatId, messageId, contentParts, language, thinking_details) =>
        {
            updateMessageContentLocal(projId, chatId, messageId, contentParts, language, thinking_details);
        },
        onSyncMessageToBackend: async (projId, chatId, messageId, contentParts, language, thinking_details) =>
        {
            await updateMessage(projId, chatId, messageId, contentParts, language, thinking_details);
        },
        onFunctionCalls: (_projId, _chatId, messageId, functionCalls, sessionId) =>
        {
            // Register sessionId for this message so function call errors can update the toast
            if (sessionId) {
                registerSessionForMessage(messageId, sessionId);
            }
            handleFunctionCalls(messageId, functionCalls);
        },
        onAddMessage: async (projId, chatId, message, language) =>
        {
            return await addMessage(projId, chatId, message, language);
        },
        onGetChatHistory: (projId, chatId, language) => getMessages(projId, chatId, language),
        onError: (error) =>
        {
            console.error('Runtime processing error:', error);
            const detail = error instanceof BackendError ? error.detail : null;
            showError('Chat Error', error.message || 'An error occurred during processing. Please try again.', detail);
        },
        onFunctionCallProgress: (_projId, _chatId, messageId, progressEvents) =>
        {
            handleFunctionCallProgress(messageId, progressEvents);
        },
    }), [updateMessageContentLocal, updateMessage, handleFunctionCalls, addMessage, getMessages, showError, handleFunctionCallProgress, registerSessionForMessage]);

    const chatManager = useMemo(() =>
    {
        const activeProjectId = projectId ?? '';
        return new ChatManager(
            {
                projectId: activeProjectId,
                getStoryObjects: () => storyObjects,
                getIsLoading: () => useChatUIStore.getState().isLoading(activeProjectId),
                setIsLoading: (loading: boolean) => useChatUIStore.getState().setLoading(activeProjectId, loading),
                abortControllerRef,
                getActiveChatId: () =>
                {
                    if (!activeProjectId) return undefined;
                    return getSelectedChatId(activeProjectId);
                },
                getConversationLanguage: () => mainLanguage,
                aiModel: chatFunctionConfig.model,
                temperature: chatFunctionConfig.temperature,
                provider: chatFunctionConfig.provider,
                providerConfig: providerCredentials[chatFunctionConfig.provider],
                functions: WORKSPACE_FUNCTIONS,
                mode: 'workspace',
                enablePrefill: chatFunctionConfig.advanced.enablePrefill,
                thinkingMode: chatFunctionConfig.advanced.thinkingMode,
                thinkingConfig: chatFunctionConfig.advanced.thinkingConfig,
                retryConfig: settings.retryConfig,
                getPendingFunctionCallResults: () => pendingFunctionCallResults,
                getSelectedContextIds: () => selectedContextIdsRef.current,
            },
            chatManagerCallbacks
        );
    }, [
        projectId,
        storyObjects,
        // Note: chatUI is intentionally excluded - it's accessed via closures and
        // including it causes ChatManager recreation during streaming state changes
        // pendingFunctionCallResults is also excluded - accessed via getter function
        mainLanguage,
        chatFunctionConfig,
        providerCredentials,
        getSelectedChatId,
        chatManagerCallbacks,
        settings.retryConfig,
    ]);

    const chatHandlers = useChatHandlers(
        projectId,
        chatManager,
        pendingFunctionCallResults,
        () => setPendingFunctionCallResults([])
    );

    const currentProject = getCurrentProject();

    // Populate unified store cache when projectId changes
    // Fetches all objects with all languages
    useEffect(() =>
    {
        if (!projectId) return;

        const populateStoreCache = async () => {
            try {
                // Fetch all objects (returns all languages per object)
                await Promise.all([
                    listObjects('basic_info', projectId),
                    listObjects('character', projectId),
                    listObjects('organization', projectId),
                    listObjects('location', projectId),
                    listObjects('lorebook', projectId),
                    listObjects('act', projectId),
                    listObjects('chapter', projectId),
                ]);
            } catch (error) {
                // Don't show error for expected 404s (outline/basicInfo not created yet)
                console.error('Failed to load story objects:', error);
                const errorStatus = (error as any)?.status || (error as any)?.response?.status;
                if (errorStatus !== 404) {
                    showError('Data Error', 'Failed to load story objects. Please try again.');
                }
            }
        };

        populateStoreCache();
    }, [projectId, listObjects, showError]);

    // Fetch chats when projectId changes
    useEffect(() =>
    {
        if (!projectId) return;

        fetchChats(projectId).catch(error =>
        {
            console.error('Failed to fetch chats:', error);
            showError('Data Error', 'Failed to load chats. Please try again.');
        });
    }, [projectId, fetchChats, showError]);

    useEffect(() =>
    {
        if (!projectId) return;

        const chatId = getSelectedChatId(projectId);
        if (!chatId) return;

        const messages = getMessages(projectId, chatId, mainLanguage);
        const restored: Record<string, EditCard[]> = {};
        const restoredConfirmed: Record<string, boolean> = {};

        messages.forEach(message =>
        {
            const processed = displayProcessor.process(message as any, {
                projectId,
                mode: 'workspace',
            } as any);

            if (processed.editCards.length > 0)
            {
                const cards = processed.editCards.map(card =>
                {
                    if (message.role === 'assistant' && message.functionCalls)
                    {
                        const funcCall = message.functionCalls.find(fc => fc.id === card.id);
                        if (funcCall)
                        {
                            return {
                                ...card,
                                appliedAt: funcCall.appliedAt,
                                onApply: createFunctionCallApplyHandler(message.id, funcCall),
                                onReject: createFunctionCallRejectHandler(message.id, funcCall),
                            };
                        }
                    }
                    return card;
                });
                restored[message.id] = cards;

                // Check if all function calls in this message have been applied/rejected
                const allProcessed = cards.every(card => card.isApplied || card.isRejected);
                if (allProcessed && cards.length > 0)
                {
                    restoredConfirmed[message.id] = true;
                }
            }
        });

        if (!areEditCardMapsEqual(messageEditCards, restored))
        {
            setMessageEditCards(restored);
        }

        // Restore confirmed state for messages that were already processed
        if (Object.keys(restoredConfirmed).length > 0)
        {
            setConfirmedMessages(prev => ({ ...prev, ...restoredConfirmed }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        projectId,
        getSelectedChatId,
        getMessages,
        mainLanguage,
        displayProcessor,
        storyObjects,
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
        // Note: messageEditCards, setMessageEditCards, setConfirmedMessages intentionally omitted to prevent render loops
        // messageEditCards is only used for comparison, not as a trigger
    ]);

    // Show loading state
    if (projectsLoading && !currentProject)
    {
        return (
            <div className="error-container">
                <p>Loading project...</p>
            </div>
        );
    }

    if (!currentProject)
    {
        return (
            <div className="error-container">
                <h2>Project Not Found</h2>
                <Link to="/">Go back to Home</Link>
            </div>
        );
    }

    return (
        <div className="workspace-container">
            <PageHeader
                projectId={projectId ?? ''}
                projectName={currentProject.name}
                pageTitle="Workspace"
                availableLanguages={availableLanguages}
                currentLanguage={displayLanguage || mainLanguage}
                onLanguageChange={setDisplayLanguage}
                showTranslateAll={settings.subLanguages && settings.subLanguages.length > 0 && objectsNeedingTranslation > 0}
                translateCount={objectsNeedingTranslation}
                onTranslateAllClick={() => setShowTranslateModal(true)}
                onSettingsClick={() => uiActions.setIsSettingsOpen(true)}
                mobileSubtitle={tabLabels[uiState.activeStoryTab]}
                showHamburger={true}
                onHamburgerClick={() => sidebarStore.toggleSidebar(projectId ?? '', 'workspace-tabs')}
            />

            <div className={`workspace-content ${isChatVisible ? 'chat-visible' : ''}`}>
                <ChatPanel
                    projectId={projectId ?? ''}
                    selectedContextIds={selectedContextIds}
                    onContextIdsChange={setSelectedContextIds}
                    totalObjectCount={totalObjectCount}
                    storyObjects={storyObjects as unknown as import('../types/storyObject').StoryObjects}
                    messageEditCards={messageEditCards}
                    activeFunctionCalls={activeFunctionCalls}
                    onBatchConfirm={handleBatchConfirm}
                    isMessageConfirmed={isMessageConfirmed}
                    onSubmit={chatHandlers.handleSubmit}
                    onStop={chatHandlers.handleStop}
                    onEditMessage={chatHandlers.handleEditMessage}
                    onEditContentChange={chatHandlers.handleEditContentChange}
                    onSaveEdit={chatHandlers.handleSaveEdit}
                    onCancelEdit={chatHandlers.handleCancelEdit}
                    onDeleteMessage={chatHandlers.handleDeleteMessage}
                    editTextareaRef={chatHandlers.editTextareaRef as React.RefObject<HTMLTextAreaElement>}
                    mode="workspace"
                    onClose={handleCloseChat}
                />

                <StoryPanel
                    activeStoryTab={uiState.activeStoryTab}
                    onTabChange={uiActions.setActiveStoryTab}
                    globalDisplayLanguage={displayLanguage || mainLanguage}
                />
            </div>

            <ChatSidebar
                projectId={projectId ?? ''}
                onSelectChat={chatHandlers.handleSelectChat}
            />

            <WorkspaceTabsSidebar
                projectId={projectId ?? ''}
                activeTab={uiState.activeStoryTab}
                onTabChange={uiActions.setActiveStoryTab}
            />

            {(isChatVisible || isOverlayClosing) && (
                <div
                    className={`chat-overlay mobile-only ${isOverlayClosing ? 'closing' : ''}`}
                    onClick={handleCloseChat}
                    onAnimationEnd={handleOverlayAnimationEnd}
                />
            )}

            <MobileFooter
                isChatVisible={isChatVisible}
                onChatToggle={() => {
                    if (isChatVisible) {
                        handleCloseChat();
                    } else {
                        toggleChatVisible(projectId ?? '');
                    }
                    sidebarStore.closeSidebar(projectId ?? '');
                }}
                onSettingsClick={() => uiActions.setIsSettingsOpen(true)}
            />

            <TranslationModal
                isOpen={showTranslateModal}
                onClose={() => setShowTranslateModal(false)}
                projectId={projectId || ''}
                onComplete={handleTranslateComplete}
                allowedObjectTypes={['basic_info', 'character', 'organization', 'location', 'lorebook', 'act', 'chapter']}
            />

            <ErrorModal
                isOpen={!!currentError}
                type={currentError?.type}
                title={currentError?.title || ''}
                message={currentError?.message || ''}
                detail={currentError?.detail}
                onClose={hideError}
            />

            <SettingsModal
                isOpen={uiState.isSettingsOpen}
                onClose={() => uiActions.setIsSettingsOpen(false)}
            />
        </div>
    );
};

export default Workspace;



