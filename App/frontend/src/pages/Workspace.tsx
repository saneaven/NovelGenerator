import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { SystemInsertConfig, EditCard } from '../chat/types';
import { ChatManager, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { areEditCardMapsEqual } from '../chat/utils/editCardUtils';
import { WORKSPACE_FUNCTIONS } from '../chat/types/functionCalling';
import { useChatStore } from '../store/chatStore';
import { useChatUIStore } from '../store/chatUIStore';
import { useProjectStore } from '../store/projectStore';
import { useUnifiedObjectStore, useStoryObjects } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';

import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import LanguageDropdown from '../components/ui/LanguageDropdown';
import BatchTranslationModal from '../components/BatchTranslationModal';
import ChatPanel from './workspace/components/ChatPanel';
import StoryPanel from './workspace/components/StoryPanel';

import { useWorkspaceState } from './workspace/hooks/useWorkspaceState';
import { useChatHandlers } from './workspace/hooks/useChatHandlers';
import { useFunctionCallHandlers } from './workspace/hooks/useFunctionCallHandlers';

import './Workspace.css';
import './workspace/styles/ChatPanel.css';
import './workspace/styles/ChatHeader.css';
import './workspace/styles/ChatMessages.css';
import './workspace/styles/MessageEdit.css';
import './workspace/styles/ChatInput.css';
import './workspace/styles/ChatSidebar.css';
import './workspace/styles/MessageEditCards.css';
import '../components/MobileChat.css';

const Workspace: React.FC = () =>
{
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();

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
    const chatFunctionConfig = useSettingsStore(state => state.settings.functionConfigs.chat);
    const providerCredentials = useSettingsStore(state => state.settings.providerCredentials);
    const { currentError, showError, hideError } = useErrorStore();
    const chatUI = useChatUIStore();

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

    // Batch translation modal state
    const [showBatchTranslateModal, setShowBatchTranslateModal] = useState(false);
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
            const availableLangs = obj.languages?.available || [];
            const needsAnyTranslation = settings.subLanguages.some(
                (subLang: string) => !availableLangs.includes(subLang)
            );

            if (needsAnyTranslation) {
                count++;
            }
        });

        return count;
    }, [unifiedStore.objects, projectId, settings.subLanguages]);

    // Handler for batch translation complete
    const handleBatchTranslateComplete = () => {
        // Refresh objects after batch translation
        if (projectId) {
            listObjects('basic_info', projectId, uiState.globalDisplayLanguage);
            listObjects('character', projectId, uiState.globalDisplayLanguage);
            listObjects('organization', projectId, uiState.globalDisplayLanguage);
            listObjects('location', projectId, uiState.globalDisplayLanguage);
            listObjects('lorebook', projectId, uiState.globalDisplayLanguage);
            listObjects('act', projectId, uiState.globalDisplayLanguage);
            listObjects('chapter', projectId, uiState.globalDisplayLanguage);
        }
        setShowBatchTranslateModal(false);
    };

    // Derive story objects reactively from unified store
    const storyObjects = useStoryObjects(projectId);

    // Fetch projects if not loaded
    useEffect(() => {
        if (projectId && projects.length === 0) {
            fetchProjects();
        }
    }, [projectId, projects.length, fetchProjects]);

    const [systemInsertConfig, setSystemInsertConfig] = useState<SystemInsertConfig>(
        ChatPipeline.createDefaultSystemConfig()
    );
    const chatPipeline = useMemo(() => new ChatPipeline(), []);
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
        onFunctionCalls: (_projId, _chatId, messageId, functionCalls) =>
        {
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
            showError('Chat Error', error.message || 'An error occurred during processing. Please try again.');
        },
        onFunctionCallProgress: (_projId, _chatId, messageId, progressEvents) =>
        {
            handleFunctionCallProgress(messageId, progressEvents);
        },
    }), [updateMessageContentLocal, updateMessage, handleFunctionCalls, addMessage, getMessages, showError, handleFunctionCallProgress]);

    const chatManager = useMemo(() =>
    {
        const activeProjectId = projectId ?? '';
        return new ChatManager(
            {
                projectId: activeProjectId,
                getStoryObjects: () => storyObjects,
                systemInsertConfig,
                chatPipeline,
                getIsLoading: () => chatUI.isLoading(activeProjectId),
                setIsLoading: (loading: boolean) => chatUI.setLoading(activeProjectId, loading),
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
                providerPreference: chatFunctionConfig.providerPreference,
                functions: WORKSPACE_FUNCTIONS,
                mode: 'workspace',
                enablePrefill: chatFunctionConfig.advanced.enablePrefill,
                thinkingMode: chatFunctionConfig.advanced.thinkingMode,
                thinkingConfig: chatFunctionConfig.advanced.thinkingConfig,
            },
            chatManagerCallbacks
        );
    }, [
        projectId,
        storyObjects,
        systemInsertConfig,
        chatPipeline,
        chatUI,
        mainLanguage,
        chatFunctionConfig,
        providerCredentials,
        getSelectedChatId,
        chatManagerCallbacks,
    ]);

    const chatHandlers = useChatHandlers(
        projectId,
        chatManager,
        pendingFunctionCallResults,
        () => setPendingFunctionCallResults([])
    );

    const currentProject = getCurrentProject();

    // Populate unified store cache when projectId changes
    // The useStoryObjects hook will reactively derive storyObjects from the cache
    useEffect(() =>
    {
        if (!projectId) return;

        const populateStoreCache = async () => {
            try {
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
            const processed = displayProcessor.process(message, {
                projectId,
                storyObjects,
                systemInsertConfig,
                mode: 'workspace',
            });

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
        systemInsertConfig,
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
            <div className="workspace-header">
                <div className="breadcrumb">
                    <Link to="/" className="breadcrumb-link">Home</Link>
                    <span className="breadcrumb-separator"> / </span>
                    <Link to={`/project/${projectId}`} className="breadcrumb-link">{currentProject.name}</Link>
                    <span className="breadcrumb-separator"> / </span>
                    <span className="breadcrumb-current">Workspace</span>
                </div>
                <div className="workspace-title">
                    <h1>{`${currentProject.name} - Workspace`}</h1>
                    <div className="workspace-controls">
                        <button
                            className="back-btn mobile-only"
                            onClick={() => navigate(`/project/${projectId}`)}
                            title="Back to project"
                        >
                            ←
                        </button>
                        <button
                            className={`chat-toggle-btn mobile-only ${chatUI.isChatVisible(projectId ?? '') ? 'active' : ''}`}
                            onClick={() =>
                            {
                                chatUI.toggleChatVisible(projectId ?? '');
                                chatUI.setMobileSidebarVisible(projectId ?? '', false);
                            }}
                        >
                            Chat
                        </button>
                        {availableLanguages.length > 1 && (
                            <LanguageDropdown
                                languages={availableLanguages}
                                value={uiState.globalDisplayLanguage}
                                onChange={uiActions.setGlobalDisplayLanguage}
                                title="Select display language"
                                showTranslateAll={settings.subLanguages && settings.subLanguages.length > 0 && objectsNeedingTranslation > 0}
                                translateCount={objectsNeedingTranslation}
                                onTranslateAllClick={() => setShowBatchTranslateModal(true)}
                            />
                        )}
                        <button
                            className="settings-btn"
                            onClick={() => uiActions.setIsSettingsOpen(true)}
                            title="Settings"
                        >
                            ⚙
                        </button>
                    </div>
                </div>
            </div>

            <div className={`workspace-content ${chatUI.isChatVisible(projectId ?? '') ? 'chat-visible' : ''}`}>
                <ChatSidebar
                    projectId={projectId ?? ''}
                    onSelectChat={chatHandlers.handleSelectChat}
                />

                <ChatPanel
                    projectId={projectId ?? ''}
                    systemInsertConfig={systemInsertConfig}
                    setSystemInsertConfig={setSystemInsertConfig}
                    chatPipeline={chatPipeline}
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
                />

                <StoryPanel
                    activeStoryTab={uiState.activeStoryTab}
                    onTabChange={uiActions.setActiveStoryTab}
                    globalDisplayLanguage={uiState.globalDisplayLanguage}
                />
            </div>

            {chatUI.isChatVisible(projectId ?? '') && (
                <div className="chat-overlay mobile-only" onClick={() => chatUI.setChatVisible(projectId ?? '', false)} />
            )}

            {chatUI.isMobileSidebarVisible(projectId ?? '') && (
                <div className="sidebar-overlay mobile-only" onClick={() => chatUI.setMobileSidebarVisible(projectId ?? '', false)} />
            )}

            {chatUI.isDesktopChatListVisible(projectId ?? '') && (
                <div className="desktop-chat-overlay desktop-only" onClick={() => chatUI.setDesktopChatListVisible(projectId ?? '', false)} />
            )}

            {/* Mobile Footer */}
            <footer className="mobile-footer">
                <button
                    className="footer-back-btn"
                    onClick={() => navigate(`/project/${projectId}`)}
                    title="Back to project"
                >
                    ←
                </button>
                <button
                    className={`footer-chat-toggle-btn ${chatUI.isChatVisible(projectId ?? '') ? 'active' : ''}`}
                    onClick={() =>
                    {
                        chatUI.toggleChatVisible(projectId ?? '');
                        chatUI.setMobileSidebarVisible(projectId ?? '', false);
                    }}
                >
                    Chat
                </button>
                {availableLanguages.length > 1 && (
                    <LanguageDropdown
                        languages={availableLanguages}
                        value={uiState.globalDisplayLanguage}
                        onChange={uiActions.setGlobalDisplayLanguage}
                        title="Select display language"
                        showTranslateAll={settings.subLanguages && settings.subLanguages.length > 0 && objectsNeedingTranslation > 0}
                        translateCount={objectsNeedingTranslation}
                        onTranslateAllClick={() => setShowBatchTranslateModal(true)}
                    />
                )}
                <button
                    className="footer-settings-btn"
                    onClick={() => uiActions.setIsSettingsOpen(true)}
                    title="Settings"
                >
                    ⚙
                </button>
            </footer>

            <BatchTranslationModal
                isOpen={showBatchTranslateModal}
                onClose={() => setShowBatchTranslateModal(false)}
                projectId={projectId || ''}
                onComplete={handleBatchTranslateComplete}
            />

            <ErrorModal
                isOpen={!!currentError}
                type={currentError?.type}
                title={currentError?.title || ''}
                message={currentError?.message || ''}
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



