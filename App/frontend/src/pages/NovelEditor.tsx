import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChatPipeline } from '../chat/ChatPipeline';
import type { SystemInsertConfig, EditCard } from '../chat/types';
import { ChatManager, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { areEditCardMapsEqual } from '../chat/utils/editCardUtils';
import { NOVEL_EDITOR_FUNCTIONS } from '../chat/types/functionCalling';
import { useChatStore } from '../store/chatStore';
import { useProjectStore } from '../store/projectStore';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useNovelStore } from '../store/novelStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';

import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal';
import ChatPanel from './workspace/components/ChatPanel';
import NovelEditorPanel from './noveleditor/components/NovelEditorPanel';

import { useNovelEditorState } from './noveleditor/hooks/useNovelEditorState';
import { useChatHandlers } from './workspace/hooks/useChatHandlers';
import { useNovelEditorFunctionCallHandlers } from './noveleditor/hooks/useNovelEditorFunctionCallHandlers';

import './NovelEditor.css';
import './workspace/styles/ChatPanel.css';
import './workspace/styles/ChatHeader.css';
import './workspace/styles/ChatMessages.css';
import './workspace/styles/MessageEdit.css';
import './workspace/styles/ChatInput.css';
import './workspace/styles/ChatSidebar.css';
import './workspace/styles/MessageEditCards.css';

const NovelEditor: React.FC = () =>
{
    const { projectId } = useParams<{ projectId: string }>();

    const { getCurrentProject } = useProjectStore();
    const {
        addMessage,
        updateMessage,
        getMessages,
        getSelectedChatId,
    } = useChatStore();
    const { getStoryObjects, getChapterById } = useStoryObjectStore();
    const novelStore = useNovelStore();
    const { settings } = useSettingsStore();
    const { currentError, showError, hideError } = useErrorStore();

    const { state: uiState, actions: uiActions } = useNovelEditorState();

    const [systemInsertConfig, setSystemInsertConfig] = useState<SystemInsertConfig>(
        ChatPipeline.createDefaultSystemConfig()
    );
    const chatPipeline = useMemo(() => new ChatPipeline(), []);
    const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
    const abortControllerRef = useRef<AbortController | null>(null);

    const functionCallHandlers = useNovelEditorFunctionCallHandlers(projectId);
    const {
        messageEditCards,
        activeFunctionCalls,
        pendingFunctionCallResults,
        setPendingFunctionCallResults,
        setMessageEditCards,
        handleFunctionCalls,
        handleFunctionCallsDetected,
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
    } = functionCallHandlers;

    const chatManagerCallbacks = useMemo<ChatManagerCallbacks>(() => ({
        onUpdateMessage: (projId, chatId, messageId, content, language) =>
        {
            updateMessage(projId, chatId, messageId, content, language);
        },
        onFunctionCalls: (_projId, _chatId, messageId, functionCalls) =>
        {
            handleFunctionCalls(messageId, functionCalls);
        },
        onAddMessage: (projId, chatId, message, language) =>
        {
            addMessage(projId, chatId, message, language);
        },
        onGetChatHistory: (projId, chatId, language) => getMessages(projId, chatId, language),
        onError: (error) =>
        {
            console.error('Runtime processing error:', error);
            showError('Chat Error', 'An error occurred during processing. Please try again.');
        },
        onFunctionCallsDetected: (_projId, _chatId, messageId, functionCalls) =>
        {
            handleFunctionCallsDetected(messageId, functionCalls);
        },
    }), [updateMessage, handleFunctionCalls, addMessage, getMessages, showError, handleFunctionCallsDetected]);

    const chatManager = useMemo(() =>
    {
        const activeProjectId = projectId ?? '';
        return new ChatManager(
            {
                projectId: activeProjectId,
                getStoryObjects: () => getStoryObjects(activeProjectId),
                getNovelData: () => novelStore.getAllChapterContents(activeProjectId),
                systemInsertConfig,
                chatPipeline,
                isLoading: uiState.isLoading,
                setIsLoading: uiActions.setIsLoading,
                abortControllerRef,
                getActiveChatId: () =>
                {
                    if (uiState.selectedChatId) return uiState.selectedChatId;
                    if (!activeProjectId) return undefined;
                    return getSelectedChatId(activeProjectId);
                },
                getConversationLanguage: () => settings.primaryLanguage,
                aiModel: settings.aiModel,
                provider: settings.activeProvider,
                providerConfig: settings.providers[settings.activeProvider],
                functions: NOVEL_EDITOR_FUNCTIONS,
                mode: 'novel-editor',
            },
            chatManagerCallbacks
        );
    }, [
        projectId,
        getStoryObjects,
        novelStore,
        systemInsertConfig,
        chatPipeline,
        uiState.isLoading,
        uiActions.setIsLoading,
        uiState.selectedChatId,
        settings.primaryLanguage,
        settings.aiModel,
        getSelectedChatId,
        chatManagerCallbacks,
    ]);

    const chatHandlers = useChatHandlers(
        projectId,
        uiActions,
        chatManager,
        pendingFunctionCallResults,
        () => setPendingFunctionCallResults([])
    );

    const currentProject = getCurrentProject();
    const storyObjects = getStoryObjects(projectId ?? '');
    const selectedChapterId = novelStore.getSelectedChapterId(projectId ?? '');
    const selectedChapter = selectedChapterId ? getChapterById(projectId ?? '', selectedChapterId) : null;

    useEffect(() =>
    {
        if (!projectId) return;

        const chatId = uiState.selectedChatId ?? getSelectedChatId(projectId);
        if (!chatId) return;

        const messages = getMessages(projectId, chatId, settings.primaryLanguage);
        const restored: Record<string, EditCard[]> = {};

        messages.forEach(message =>
        {
            const processed = displayProcessor.process(message, {
                projectId,
                storyObjects,
                systemInsertConfig,
                mode: 'novel-editor',
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
    }, [
        projectId,
        uiState.selectedChatId,
        getSelectedChatId,
        getMessages,
        settings.primaryLanguage,
        displayProcessor,
        storyObjects,
        systemInsertConfig,
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
        messageEditCards,
        setMessageEditCards,
    ]);

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
        <div className="novel-editor-container">
            <div className="novel-editor-header">
                <div className="breadcrumb">
                    <Link to="/" className="breadcrumb-link">Home</Link>
                    <span className="breadcrumb-separator"> / </span>
                    <Link to={`/project/${projectId}`} className="breadcrumb-link">{currentProject.name}</Link>
                    <span className="breadcrumb-separator"> / </span>
                    <span className="breadcrumb-current">Novel Editor</span>
                </div>
                <div className="novel-editor-title">
                    <div className="title-section">
                        <h1>Novel Editor</h1>
                    </div>
                    <div className="novel-editor-controls">
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

            <div className={`novel-editor-content ${uiState.isChatVisible ? 'chat-visible' : ''}`}>
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
                    novelData={novelStore.getAllChapterContents(projectId ?? '')}
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
                    mode="novel-editor"
                />

                <NovelEditorPanel
                    projectId={projectId ?? ''}
                    selectedChapter={selectedChapter}
                    selectedChapterId={selectedChapterId || null}
                    storyObjects={storyObjects}
                    uiState={uiState}
                    uiActions={uiActions}
                    onToggleSidebar={() => uiActions.setIsChapterSidebarVisible(!uiState.isChapterSidebarVisible)}
                    onSelectChapter={(chapterId) => novelStore.selectChapter(projectId ?? '', chapterId)}
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

export default NovelEditor;

