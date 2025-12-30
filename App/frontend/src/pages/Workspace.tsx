import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';
import { useChatUIStore } from '../store/chatUIStore';
import { useSidebarStore } from '../store/sidebarStore';
import { useProjectStore } from '../store/projectStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';

import ErrorModal from '../components/ErrorModal';
import SettingsModal from '../components/SettingsModal/SettingsModal';
import TranslationModal from '../components/TranslationModal';
import ChatPanel from './workspace/components/ChatPanel';
import StoryPanel from './workspace/components/StoryPanel';
import WorkspaceTabsSidebar from './workspace/components/WorkspaceTabsSidebar';
import { PageHeader, MobileFooter } from '../components/layout';

import { useWorkspaceState } from './workspace/hooks/useWorkspaceState';

import './Workspace.css';
import './workspace/styles/ChatPanel.css';
import './workspace/styles/ChatHeader.css';
import './workspace/styles/ChatMessages.css';
import './workspace/styles/MessageEdit.css';
import './workspace/styles/ChatInput.css';
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

const Workspace: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();

    const { getCurrentProject, fetchProjects, projects, isLoading: projectsLoading } = useProjectStore();
    const { fetchChats } = useChatStore();
    const listObjects = useUnifiedObjectStore(state => state.listObjects);
    const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
    const displayLanguage = useSettingsStore(state => state.settings.displayLanguage);
    const setDisplayLanguage = useSettingsStore(state => state.setDisplayLanguage);
    const { currentError, showError, hideError } = useErrorStore();

    // Use selectors to avoid re-rendering on input changes
    const isChatVisibleState = useChatUIStore((state) => state.chatVisibleByProject[projectId ?? ''] ?? false);
    const setChatVisible = useChatUIStore((state) => state.setChatVisible);
    const toggleChatVisible = useChatUIStore((state) => state.toggleChatVisible);
    const isDesktopView = typeof window !== 'undefined' && window.innerWidth > 768;
    const isChatVisible = isDesktopView ? true : isChatVisibleState;
    const sidebarStore = useSidebarStore();
    const unifiedStore = useUnifiedObjectStore();

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

    // Build available languages list (main + all sub languages)
    const availableLanguages = useMemo(() => {
        const languages = [settings.mainLanguage];
        if (settings.subLanguages && settings.subLanguages.length > 0) {
            languages.push(...settings.subLanguages);
        }
        return languages;
    }, [settings.mainLanguage, settings.subLanguages]);

    // Allowed types for translation (must match TranslationModal's allowedObjectTypes prop)
    const WORKSPACE_TRANSLATION_TYPES = ['basic_info', 'character', 'organization', 'location', 'lorebook', 'act', 'chapter'];

    // Calculate count of objects needing translation to any sub language
    const objectsNeedingTranslation = useMemo(() => {
        if (!settings.subLanguages || settings.subLanguages.length === 0 || !projectId) return 0;

        const allObjects = Object.values(unifiedStore.objects);
        let count = 0;

        allObjects.forEach((obj: any) => {
            if (obj.metadata?.project_id !== projectId) return;
            if (!WORKSPACE_TRANSLATION_TYPES.includes(obj.type)) return;

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


    // Fetch projects if not loaded
    useEffect(() => {
        if (projectId && projects.length === 0) {
            fetchProjects();
        }
    }, [projectId, projects.length, fetchProjects]);

    // Populate unified store cache when projectId changes
    useEffect(() => {
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
    useEffect(() => {
        if (!projectId) return;

        fetchChats(projectId).catch(error => {
            console.error('Failed to fetch chats:', error);
            showError('Data Error', 'Failed to load chats. Please try again.');
        });
    }, [projectId, fetchChats, showError]);

    const currentProject = getCurrentProject();

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
                    mode="workspace"
                />

                <StoryPanel
                    activeStoryTab={uiState.activeStoryTab}
                    onTabChange={uiActions.setActiveStoryTab}
                    globalDisplayLanguage={displayLanguage || mainLanguage}
                />
            </div>

            <WorkspaceTabsSidebar
                projectId={projectId ?? ''}
                activeTab={uiState.activeStoryTab}
                onTabChange={uiActions.setActiveStoryTab}
            />

            <MobileFooter
                isChatVisible={isChatVisible}
                onChatToggle={() => {
                    if (isChatVisible) {
                        setChatVisible(projectId ?? '', false);
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
