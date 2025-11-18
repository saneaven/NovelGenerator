import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { SystemInsertConfig, EditCard } from '../chat/types';
import { ChatManager, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { areEditCardMapsEqual } from '../chat/utils/editCardUtils';
import { WORKSPACE_FUNCTIONS } from '../chat/types/functionCalling';
import { useChatStore } from '../store/chatStore';
import { useProjectStore } from '../store/projectStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import type { StoryObjects } from '../types/storyObject';

import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal/SettingsModal';
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
    const primaryLanguage = useSettingsStore(state => state.settings.primaryLanguage);
    const chatFunctionConfig = useSettingsStore(state => state.settings.functionConfigs.chat);
    const providerCredentials = useSettingsStore(state => state.settings.providerCredentials);
    const { currentError, showError, hideError } = useErrorStore();

    const { state: uiState, actions: uiActions } = useWorkspaceState(projectId);

    // State to hold story objects built from unified store
    const [storyObjects, setStoryObjects] = useState<StoryObjects>({
        basicInfo: null,
        characters: [],
        organizations: [],
        locations: [],
        lorebook: [],
        outline: { acts: [] },
    });

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
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
    } = useFunctionCallHandlers(projectId);

    const chatManagerCallbacks = useMemo<ChatManagerCallbacks>(() => ({
        onUpdateMessage: (projId, chatId, messageId, contentParts, language, reasoning_details) =>
        {
            updateMessageContentLocal(projId, chatId, messageId, contentParts, language, reasoning_details);
        },
        onSyncMessageToBackend: async (projId, chatId, messageId, contentParts, language, reasoning_details) =>
        {
            await updateMessage(projId, chatId, messageId, contentParts, language, reasoning_details);
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
            showError('Chat Error', 'An error occurred during processing. Please try again.');
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
                getIsLoading: () => uiState.isLoading, // Use getter to prevent ChatManager recreation
                setIsLoading: uiActions.setIsLoading,
                abortControllerRef,
                getActiveChatId: () =>
                {
                    if (uiState.selectedChatId) return uiState.selectedChatId;
                    if (!activeProjectId) return undefined;
                    return getSelectedChatId(activeProjectId);
                },
                getConversationLanguage: () => primaryLanguage,
                aiModel: chatFunctionConfig.model,
                temperature: chatFunctionConfig.temperature,
                provider: chatFunctionConfig.provider,
                providerConfig: providerCredentials[chatFunctionConfig.provider],
                providerPreference: chatFunctionConfig.providerPreference,
                functions: WORKSPACE_FUNCTIONS,
                mode: 'workspace',
                enablePrefill: chatFunctionConfig.advanced.enablePrefill,
                thinkingMode: chatFunctionConfig.advanced.thinkingMode,
                reasoningConfig: chatFunctionConfig.advanced.reasoningConfig,
            },
            chatManagerCallbacks
        );
    }, [
        projectId,
        storyObjects,
        systemInsertConfig,
        chatPipeline,
        uiActions.setIsLoading,
        uiState.selectedChatId,
        primaryLanguage,
        chatFunctionConfig,
        providerCredentials,
        getSelectedChatId,
        llmRequestManagerCallbacks,
    ]);

    const chatHandlers = useChatHandlers(
        projectId,
        uiActions,
        chatManager,
        pendingFunctionCallResults,
        () => setPendingFunctionCallResults([])
    );

    const currentProject = getCurrentProject();

    // Build story objects from unified store when projectId changes
    useEffect(() =>
    {
        if (!projectId) return;

        const buildStoryObjects = async () => {
            try {
                const [basicInfoList, characters, organizations, locations, lorebook, acts, chapters] = await Promise.all([
                    listObjects('basic_info', projectId),
                    listObjects('character', projectId),
                    listObjects('organization', projectId),
                    listObjects('location', projectId),
                    listObjects('lorebook', projectId),
                    listObjects('act', projectId),
                    listObjects('chapter', projectId),
                ]);

                // Build basic info
                const basicInfo = basicInfoList.length > 0 ? {
                    id: basicInfoList[0].id,
                    title: basicInfoList[0].data.title || '',
                    logline: basicInfoList[0].data.logline || '',
                    genre: basicInfoList[0].data.genre || '',
                } : null;

                // Build outline
                const outline = {
                    acts: acts
                        .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                        .map(act => ({
                            id: act.id,
                            name: act.data.name || '',
                            description: act.data.description || '',
                            order: act.metadata.order || 0,
                            chapters: chapters
                                .filter(ch => ch.metadata.act_id === act.id)
                                .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                                .map(chapter => ({
                                    id: chapter.id,
                                    name: chapter.data.name || '',
                                    description: chapter.data.description || '',
                                    order: chapter.metadata.order || 0,
                                    actId: chapter.metadata.act_id || '',
                                })),
                        })),
                };

                setStoryObjects({
                    basicInfo,
                    characters: characters.map(ch => ({
                        id: ch.id,
                        name: ch.data.name || '',
                        description: ch.data.description || '',
                    })),
                    organizations: organizations.map(org => ({
                        id: org.id,
                        name: org.data.name || '',
                        description: org.data.description || '',
                    })),
                    locations: locations.map(loc => ({
                        id: loc.id,
                        name: loc.data.name || '',
                        description: loc.data.description || '',
                    })),
                    lorebook: lorebook.map(entry => ({
                        id: entry.id,
                        name: entry.data.name || '',
                        description: entry.data.description || '',
                    })),
                    outline,
                });
            } catch (error) {
                // Don't show error for expected 404s (outline/basicInfo not created yet)
                console.error('Failed to load story objects:', error);
                // Only show error modal if it's a real error, not missing resources
                const errorStatus = (error as any)?.status || (error as any)?.response?.status;
                if (errorStatus !== 404) {
                    showError('Data Error', 'Failed to load story objects. Please try again.');
                }
            }
        };

        buildStoryObjects();
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

        const chatId = uiState.selectedChatId ?? getSelectedChatId(projectId);
        if (!chatId) return;

        const messages = getMessages(projectId, chatId, primaryLanguage);
        const restored: Record<string, EditCard[]> = {};

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
            }
        });

        if (!areEditCardMapsEqual(messageEditCards, restored))
        {
            setMessageEditCards(restored);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        projectId,
        uiState.selectedChatId,
        getSelectedChatId,
        getMessages,
        primaryLanguage,
        displayProcessor,
        storyObjects,
        systemInsertConfig,
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
        // Note: messageEditCards and setMessageEditCards intentionally omitted to prevent render loops
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
                            className="settings-btn"
                            onClick={() => uiActions.setIsSettingsOpen(true)}
                            title="Settings"
                        >
                            ⚙
                        </button>
                        <button
                            className={`chat-toggle-btn mobile-only ${uiState.isChatVisible ? 'active' : ''}`}
                            onClick={() =>
                            {
                                uiActions.setIsChatVisible(!uiState.isChatVisible);
                                uiActions.setIsMobileSidebarVisible(false);
                            }}
                        >
                            Chat
                        </button>
                    </div>
                </div>
            </div>

            <div className={`workspace-content ${uiState.isChatVisible ? 'chat-visible' : ''}`}>
                <ChatSidebar
                    projectId={projectId ?? ''}
                    onSelectChat={chatHandlers.handleSelectChat}
                    isMobileVisible={uiState.isMobileSidebarVisible}
                    isDesktopVisible={uiState.isDesktopChatListVisible}
                />

                <ChatPanel
                    projectId={projectId ?? ''}
                    uiState={uiState}
                    uiActions={uiActions}
                    systemInsertConfig={systemInsertConfig}
                    setSystemInsertConfig={setSystemInsertConfig}
                    chatPipeline={chatPipeline}
                    storyObjects={storyObjects}
                    messageEditCards={messageEditCards}
                    activeFunctionCalls={activeFunctionCalls}
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
                />
            </div>

            {uiState.isChatVisible && (
                <div className="chat-overlay mobile-only" onClick={() => uiActions.setIsChatVisible(false)} />
            )}

            {uiState.isMobileSidebarVisible && (
                <div className="sidebar-overlay mobile-only" onClick={() => uiActions.setIsMobileSidebarVisible(false)} />
            )}

            {uiState.isDesktopChatListVisible && (
                <div className="desktop-chat-overlay desktop-only" onClick={() => uiActions.setIsDesktopChatListVisible(false)} />
            )}

            <ErrorModal
                isOpen={!!currentError}
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



