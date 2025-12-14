import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SystemInsertConfig, EditCard } from '../chat/types';
import { ChatManager, type ChatManagerCallbacks } from '../chat/processors/ChatManager';
import { DefaultDisplayProcessor } from '../chat/processors/DisplayProcessor';
import { areEditCardMapsEqual } from '../chat/utils/editCardUtils';
import { NOVEL_EDITOR_FUNCTIONS } from '../llm/schemas/functionCalling';
import { useChatStore } from '../store/chatStore';
import { useChatUIStore } from '../store/chatUIStore';
import { useProjectStore } from '../store/projectStore';
import { useUnifiedObjectStore, useStoryObjects } from '../store/unifiedObjectStore';
import { useNovelEditorStore } from '../store/novelEditorStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import type { StoryObjects } from '../types/storyObject';

import ChatSidebar from '../components/ChatSidebar';
import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import TranslationModal from '../components/TranslationModal';
import ChatPanel from './workspace/components/ChatPanel';
import NovelEditorPanel from './noveleditor/components/NovelEditorPanel';
import { PageHeader, MobileFooter } from '../components/layout';

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
import '../components/MobileChat.css';

const NovelEditor: React.FC = () =>
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
    const unifiedObjects = useUnifiedObjectStore(state => state.objects);
    const listObjects = useUnifiedObjectStore(state => state.listObjects);
    // UI state for selected chapter and display language
    const selectedChapterByProject = useNovelEditorStore(state => state.selectedChapterByProject);
    const displayLanguageByProject = useNovelEditorStore(state => state.displayLanguageByProject);
    const getSelectedChapterId = useNovelEditorStore(state => state.getSelectedChapterId);
    const selectChapter = useNovelEditorStore(state => state.selectChapter);
    const setDisplayLanguage = useNovelEditorStore(state => state.setDisplayLanguage);

    // Reactive subscription for selectedChapterId
    const selectedChapterId = selectedChapterByProject[projectId ?? '']
        ?? localStorage.getItem(`selectedChapter_${projectId ?? ''}`)
        ?? undefined;

    // Helper to get all manuscripts from unified store (filtered by language)
    const getAllManuscripts = useMemo(() => {
        return (projId: string, language: string) => {
            // Build chapter name lookup map
            const chapterNames: Record<string, string> = {};
            Object.values(unifiedObjects).forEach(obj => {
                if (obj.type === 'chapter' && obj.metadata?.project_id === projId) {
                    const chapterData = obj.data[language]
                        ?? obj.data[Object.keys(obj.data)[0]]
                        ?? {};
                    chapterNames[obj.id] = chapterData.name ?? '';
                }
            });

            const allContent: Record<string, any> = {};
            Object.values(unifiedObjects).forEach(obj => {
                if (obj.type === 'manuscript' && obj.metadata?.project_id === projId) {
                    const chapterId = obj.metadata?.chapter_id as string;
                    if (chapterId) {
                        // Extract only specified language data (with fallback to first available)
                        const langData = obj.data[language]
                            ?? obj.data[Object.keys(obj.data)[0]]
                            ?? {};
                        allContent[chapterId] = {
                            id: obj.id,
                            chapterId,
                            chapterName: chapterNames[chapterId] ?? '',
                            content: langData.content ?? '',
                        };
                    }
                }
            });
            return allContent;
        };
    }, [unifiedObjects]);
    const settings = useSettingsStore(state => state.settings);
    const mainLanguage = settings.mainLanguage;
    const subLanguages = settings.subLanguages;
    const chatFunctionConfig = settings.functionConfigs.chat;
    const providerCredentials = settings.providerCredentials;
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

    const { state: uiState, actions: uiActions } = useNovelEditorState(projectId);

    // Story objects derived from unified store (uses main language for chat context)
    const storyObjectsFromHook = useStoryObjects(projectId, mainLanguage);
    // State to hold story objects built from unified store (for UI display)
    const [storyObjects, setStoryObjects] = useState<StoryObjects>({
        basicInfo: null,
        characters: [],
        organizations: [],
        locations: [],
        lorebook: [],
        outline: null,
    });
    const [isOutlineInitialized, setIsOutlineInitialized] = useState(false);
    const [showTranslateModal, setShowTranslateModal] = useState(false);

    // Fetch projects if not loaded
    useEffect(() => {
        if (projectId && projects.length === 0) {
            fetchProjects();
        }
    }, [projectId, projects.length, fetchProjects]);

    // Reactive subscription for display language
    const currentDisplayLanguage = displayLanguageByProject[projectId ?? ''] || mainLanguage;

    // Initialize display language in store from settings
    useEffect(() => {
        if (projectId && mainLanguage && !displayLanguageByProject[projectId]) {
            setDisplayLanguage(projectId, mainLanguage);
        }
    }, [projectId, mainLanguage, displayLanguageByProject, setDisplayLanguage]);

    const [systemInsertConfig, setSystemInsertConfig] = useState<SystemInsertConfig>({
        enabled: true,
        includeProjectInfo: true,
        includeStoryObjects: true,
        includeNovelContent: false,
    });
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
        handleFunctionCallProgress,
        handleBatchConfirm,
        isMessageConfirmed,
        setConfirmedMessages,
        createFunctionCallApplyHandler,
        createFunctionCallRejectHandler,
    } = functionCallHandlers;

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
                getStoryObjects: () => storyObjectsFromHook,
                getNovelData: () => getAllManuscripts(activeProjectId, mainLanguage),
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
                functions: NOVEL_EDITOR_FUNCTIONS,
                mode: 'novelEditor',
                enablePrefill: chatFunctionConfig.advanced.enablePrefill,
                thinkingMode: chatFunctionConfig.advanced.thinkingMode,
                thinkingConfig: chatFunctionConfig.advanced.thinkingConfig as any,
                retryConfig: settings.retryConfig,
                getPendingFunctionCallResults: () => pendingFunctionCallResults,
            },
            chatManagerCallbacks
        );
    }, [
        projectId,
        storyObjectsFromHook,
        getAllManuscripts,
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

    // Get selected chapter from unified store
    const selectedChapter = useMemo(() => {
        if (!selectedChapterId) return null;
        const chapter = unifiedObjects[selectedChapterId];
        if (!chapter || chapter.type !== 'chapter') return null;

        // Use language-keyed data access
        const langData = chapter.data[mainLanguage] || chapter.data[Object.keys(chapter.data)[0]] || {};

        return {
            id: chapter.id,
            name: langData.name || '',
            description: langData.description || '',
            order: chapter.metadata.order || 0,
            actId: chapter.metadata.act_id || '',
        };
    }, [selectedChapterId, unifiedObjects, mainLanguage]);

    const hasChapters = storyObjects.outline?.acts.some(act => act.chapters.length > 0) ?? false;

    // Compute available languages for the language selector
    const availableLanguages = useMemo(() => {
        const langs = [mainLanguage];
        if (subLanguages && subLanguages.length > 0) {
            langs.push(...subLanguages);
        }
        return [...new Set(langs)].filter(Boolean);
    }, [mainLanguage, subLanguages]);

    // Calculate count of manuscript objects needing translation
    const objectsNeedingTranslation = useMemo(() => {
        if (!subLanguages || subLanguages.length === 0 || !projectId) return 0;

        const allObjects = Object.values(unifiedObjects);
        let count = 0;

        allObjects.forEach((obj: any) => {
            if (obj.metadata?.project_id !== projectId) return;
            if (obj.type !== 'manuscript') return;

            // Check if object is missing any sub language translation
            const availableLangs = Object.keys(obj.data || {});
            const needsAnyTranslation = subLanguages.some(
                (subLang: string) => !availableLangs.includes(subLang)
            );

            if (needsAnyTranslation) {
                count++;
            }
        });

        return count;
    }, [unifiedObjects, projectId, subLanguages]);

    // Build story objects from unified store when projectId changes
    // First fetch main language objects (for chat context), then use them for UI
    // Helper to get data for a specific language from an object
    const getDataForLanguage = (obj: any, language: string): Record<string, any> => {
        if (obj.data[language]) return obj.data[language];
        const availableLanguages = Object.keys(obj.data);
        if (availableLanguages.length > 0) return obj.data[availableLanguages[0]];
        return {};
    };

    useEffect(() =>
    {
        if (!projectId) return;

        setIsOutlineInitialized(false);
        const activeProjectId = projectId;
        let isActive = true;

        const buildStoryObjects = async () => {
            try {
                // Fetch all objects (returns all languages per object)
                const [basicInfoList, characters, organizations, locations, lorebook, acts, chapters] = await Promise.all([
                    listObjects('basic_info', projectId),
                    listObjects('character', projectId),
                    listObjects('organization', projectId),
                    listObjects('location', projectId),
                    listObjects('lorebook', projectId),
                    listObjects('act', projectId),
                    listObjects('chapter', projectId),
                ]);

                // Build basic info - extract data for mainLanguage
                const basicInfo = basicInfoList.length > 0 ? (() => {
                    const data = getDataForLanguage(basicInfoList[0], mainLanguage);
                    return {
                        id: basicInfoList[0].id,
                        title: data.title || '',
                        logline: data.logline || '',
                        genre: data.genre || '',
                    };
                })() : null;

                // Build outline
                const outline = {
                    acts: acts
                        .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                        .map(act => {
                            const actData = getDataForLanguage(act, mainLanguage);
                            return {
                                id: act.id,
                                name: actData.name || '',
                                description: actData.description || '',
                                order: act.metadata.order || 0,
                                chapters: chapters
                                    .filter(ch => ch.metadata.act_id === act.id)
                                    .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                                    .map(chapter => {
                                        const chapterData = getDataForLanguage(chapter, mainLanguage);
                                        return {
                                            id: chapter.id,
                                            name: chapterData.name || '',
                                            description: chapterData.description || '',
                                            order: chapter.metadata.order || 0,
                                            actId: chapter.metadata.act_id || '',
                                        };
                                    }),
                            };
                        }),
                };

                if (isActive) {
                    setStoryObjects({
                        basicInfo,
                        characters: characters.map(ch => {
                            const data = getDataForLanguage(ch, mainLanguage);
                            return {
                                id: ch.id,
                                name: data.name || '',
                                description: data.description || '',
                            };
                        }),
                        organizations: organizations.map(org => {
                            const data = getDataForLanguage(org, mainLanguage);
                            return {
                                id: org.id,
                                name: data.name || '',
                                description: data.description || '',
                            };
                        }),
                        locations: locations.map(loc => {
                            const data = getDataForLanguage(loc, mainLanguage);
                            return {
                                id: loc.id,
                                name: data.name || '',
                                description: data.description || '',
                            };
                        }),
                        lorebook: lorebook.map(entry => {
                            const data = getDataForLanguage(entry, mainLanguage);
                            return {
                                id: entry.id,
                                name: data.name || '',
                                description: data.description || '',
                            };
                        }),
                        outline,
                    } as unknown as StoryObjects);

                    if (activeProjectId) {
                        const firstActWithChapters = outline.acts.find(act => act.chapters.length > 0);
                        const firstChapter = firstActWithChapters?.chapters[0];
                        if (firstChapter) {
                            const existingSelection = getSelectedChapterId(activeProjectId);
                            const selectionStillExists = existingSelection
                                ? outline.acts.some(act => act.chapters.some(ch => ch.id === existingSelection))
                                : false;

                            if (!selectionStillExists) {
                                selectChapter(activeProjectId, firstChapter.id);
                            }
                        }
                    }
                }
            } catch (error) {
                // Don't show error for expected 404s (outline/basicInfo not created yet)
                console.error('Failed to load story objects:', error);
                if (isActive) {
                    // Only show error modal if it's a real error, not missing resources
                    const errorStatus = (error as any)?.status || (error as any)?.response?.status;
                    if (errorStatus !== 404) {
                        showError('Data Error', 'Failed to load story objects. Please try again.');
                    }
                }
            } finally {
                if (isActive) {
                    setIsOutlineInitialized(true);
                }
            }
        };

        buildStoryObjects();
        return () => {
            isActive = false;
        };
    }, [projectId, listObjects, mainLanguage, showError, getSelectedChapterId, selectChapter]);

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

    // Note: Chapter content fetching is handled by NovelEditorPanel via unifiedObjectStore

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
                storyObjects,
                systemInsertConfig,
                mode: 'novelEditor',
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
        <div className="novel-editor-container">
            <PageHeader
                projectId={projectId ?? ''}
                projectName={currentProject.name}
                pageTitle="Novel Editor"
                availableLanguages={availableLanguages}
                currentLanguage={currentDisplayLanguage}
                onLanguageChange={(lang: string) => setDisplayLanguage(projectId ?? '', lang)}
                showTranslateAll={subLanguages && subLanguages.length > 0 && objectsNeedingTranslation > 0}
                translateCount={objectsNeedingTranslation}
                onTranslateAllClick={() => setShowTranslateModal(true)}
                onSettingsClick={() => uiActions.setIsSettingsOpen(true)}
            />

            <div className={`novel-editor-content ${chatUI.isChatVisible(projectId ?? '') ? 'chat-visible' : ''}`}>
                <ChatPanel
                    projectId={projectId ?? ''}
                    systemInsertConfig={systemInsertConfig}
                    setSystemInsertConfig={setSystemInsertConfig}
                    storyObjects={storyObjects}
                    novelData={getAllManuscripts(projectId ?? '', mainLanguage)}
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
                    mode="novelEditor"
                />

                <NovelEditorPanel
                    projectId={projectId ?? ''}
                    selectedChapter={selectedChapter}
                    selectedChapterId={selectedChapterId || null}
                    hasChapters={hasChapters}
                    chaptersInitialized={isOutlineInitialized}
                    onSelectChapter={(chapterId) => selectChapter(projectId ?? '', chapterId)}
                />
            </div>

            <ChatSidebar
                projectId={projectId ?? ''}
                onSelectChat={chatHandlers.handleSelectChat}
            />

            {chatUI.isChatVisible(projectId ?? '') && (
                <div className="chat-overlay mobile-only" onClick={() => chatUI.setChatVisible(projectId ?? '', false)} />
            )}

            {chatUI.isMobileSidebarVisible(projectId ?? '') && (
                <div className="sidebar-overlay mobile-only" onClick={() => chatUI.setMobileSidebarVisible(projectId ?? '', false)} />
            )}

            {chatUI.isDesktopChatListVisible(projectId ?? '') && (
                <div className="desktop-chat-overlay desktop-only" onClick={() => chatUI.setDesktopChatListVisible(projectId ?? '', false)} />
            )}

            <MobileFooter
                isChatVisible={chatUI.isChatVisible(projectId ?? '')}
                onChatToggle={() => {
                    chatUI.toggleChatVisible(projectId ?? '');
                    chatUI.setMobileSidebarVisible(projectId ?? '', false);
                }}
                onSettingsClick={() => uiActions.setIsSettingsOpen(true)}
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

            <TranslationModal
                isOpen={showTranslateModal}
                onClose={() => setShowTranslateModal(false)}
                projectId={projectId || ''}
                onComplete={() => setShowTranslateModal(false)}
                allowedObjectTypes={['manuscript']}
            />
        </div>
    );
};

export default NovelEditor;


