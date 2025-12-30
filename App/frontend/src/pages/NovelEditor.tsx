import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';
import { useChatUIStore } from '../store/chatUIStore';
import { useSidebarStore } from '../store/sidebarStore';
import { useProjectStore } from '../store/projectStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useNovelEditorStore } from '../store/novelEditorStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import type { StoryObjects } from '../types/storyObject';

import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import TranslationModal from '../components/TranslationModal';
import ChatPanel from './workspace/components/ChatPanel';
import NovelEditorPanel from './noveleditor/components/NovelEditorPanel';
import { PageHeader, MobileFooter } from '../components/layout';

import { useNovelEditorState } from './noveleditor/hooks/useNovelEditorState';

import './NovelEditor.css';
import './workspace/styles/ChatPanel.css';
import './workspace/styles/ChatHeader.css';
import './workspace/styles/ChatMessages.css';
import './workspace/styles/MessageEdit.css';
import './workspace/styles/ChatInput.css';
import './workspace/styles/MessageEditCards.css';
import '../components/MobileChat.css';

const NovelEditor: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();

    const { getCurrentProject, fetchProjects, projects, isLoading: projectsLoading } = useProjectStore();
    const { fetchChats } = useChatStore();
    const unifiedObjects = useUnifiedObjectStore(state => state.objects);
    const listObjects = useUnifiedObjectStore(state => state.listObjects);

    // UI state for selected chapter
    const selectedChapterByProject = useNovelEditorStore(state => state.selectedChapterByProject);
    const isSavingByProject = useNovelEditorStore(state => state.isSavingByProject);
    const hasUnsavedChangesByProject = useNovelEditorStore(state => state.hasUnsavedChangesByProject);
    const getSelectedChapterId = useNovelEditorStore(state => state.getSelectedChapterId);
    const selectChapter = useNovelEditorStore(state => state.selectChapter);

    // Display language from settingsStore (global)
    const displayLanguage = useSettingsStore(state => state.settings.displayLanguage);
    const setDisplayLanguage = useSettingsStore(state => state.setDisplayLanguage);

    // Reactive subscription for selectedChapterId
    const selectedChapterId = selectedChapterByProject[projectId ?? '']
        ?? localStorage.getItem(`selectedChapter_${projectId ?? ''}`)
        ?? undefined;

    const settings = useSettingsStore(state => state.settings);
    const mainLanguage = settings.mainLanguage;
    const subLanguages = settings.subLanguages;
    const { currentError, showError, hideError } = useErrorStore();
    const chatUI = useChatUIStore();
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

    const { state: uiState, actions: uiActions } = useNovelEditorState(projectId);

    // Local story objects state for NovelEditorPanel (includes outline structure)
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

    // Use global display language from settingsStore
    const currentDisplayLanguage = displayLanguage || mainLanguage;

    const currentProject = getCurrentProject();

    // Get selected chapter from unified store
    const selectedChapter = useMemo(() => {
        if (!selectedChapterId) return null;
        const chapter = unifiedObjects[selectedChapterId];
        if (!chapter || chapter.type !== 'chapter') return null;

        // Use display language with fallback to mainLanguage
        const langData = chapter.data[currentDisplayLanguage] || chapter.data[mainLanguage] || chapter.data[Object.keys(chapter.data)[0]] || {};

        return {
            id: chapter.id,
            name: langData.name || '',
            description: langData.description || '',
            order: chapter.metadata.order || 0,
            actId: chapter.metadata.act_id || '',
        };
    }, [selectedChapterId, unifiedObjects, currentDisplayLanguage, mainLanguage]);

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

    // Helper to get data for a specific language from an object
    const getDataForLanguage = (obj: any, language: string): Record<string, any> => {
        if (obj.data[language]) return obj.data[language];
        const availableLanguages = Object.keys(obj.data);
        if (availableLanguages.length > 0) return obj.data[availableLanguages[0]];
        return {};
    };

    // Build story objects from unified store when projectId changes
    useEffect(() => {
        if (!projectId) return;

        setIsOutlineInitialized(false);
        const activeProjectId = projectId;
        let isActive = true;

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

                const basicInfo = basicInfoList.length > 0 ? (() => {
                    const data = getDataForLanguage(basicInfoList[0], mainLanguage);
                    return {
                        id: basicInfoList[0].id,
                        title: data.title || '',
                        logline: data.logline || '',
                        genre: data.genre || '',
                    };
                })() : null;

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
                console.error('Failed to load story objects:', error);
                if (isActive) {
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
    useEffect(() => {
        if (!projectId) return;

        fetchChats(projectId).catch(error => {
            console.error('Failed to fetch chats:', error);
            showError('Data Error', 'Failed to load chats. Please try again.');
        });
    }, [projectId, fetchChats, showError]);

    // Show loading state
    if (projectsLoading && !currentProject) {
        return (
            <div className="error-container">
                <p>Loading project...</p>
            </div>
        );
    }

    if (!currentProject) {
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
                onLanguageChange={(lang: string) => setDisplayLanguage(lang)}
                showTranslateAll={subLanguages && subLanguages.length > 0 && objectsNeedingTranslation > 0}
                translateCount={objectsNeedingTranslation}
                onTranslateAllClick={() => setShowTranslateModal(true)}
                onSettingsClick={() => uiActions.setIsSettingsOpen(true)}
                mobileSubtitle={selectedChapter?.name || 'No chapter selected'}
                showHamburger={true}
                onHamburgerClick={() => sidebarStore.toggleSidebar(projectId ?? '', 'chapter')}
                showSaveIndicator={true}
                saveStatus={
                    isSavingByProject[projectId ?? '']
                        ? 'saving'
                        : hasUnsavedChangesByProject[projectId ?? '']
                            ? 'unsaved'
                            : 'saved'
                }
            />

            <div className={`novel-editor-content ${chatUI.isChatVisible(projectId ?? '') ? 'chat-visible' : ''}`}>
                <ChatPanel
                    projectId={projectId ?? ''}
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

            <MobileFooter
                isChatVisible={chatUI.isChatVisible(projectId ?? '')}
                onChatToggle={() => {
                    if (chatUI.isChatVisible(projectId ?? '')) {
                        chatUI.setChatVisible(projectId ?? '', false);
                    } else {
                        chatUI.toggleChatVisible(projectId ?? '');
                    }
                    sidebarStore.closeSidebar(projectId ?? '');
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
