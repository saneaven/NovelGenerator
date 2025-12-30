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
import OutlinePanel from './outlinemanager/components/OutlinePanel';
import { PageHeader, MobileFooter } from '../components/layout';

import './Workspace.css'; // Reuse workspace styles

const OutlineManager: React.FC = () => {
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

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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

  // Allowed types for translation in outline manager
  const OUTLINE_TRANSLATION_TYPES = ['outline', 'act', 'chapter'];

  // Calculate count of objects needing translation to any sub language
  const objectsNeedingTranslation = useMemo(() => {
    if (!settings.subLanguages || settings.subLanguages.length === 0 || !projectId) return 0;

    const allObjects = Object.values(unifiedStore.objects);
    let count = 0;

    allObjects.forEach((obj: any) => {
      if (obj.metadata?.project_id !== projectId) return;
      if (!OUTLINE_TRANSLATION_TYPES.includes(obj.type)) return;

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
      listObjects('outline', projectId);
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
          listObjects('outline', projectId),
          listObjects('act', projectId),
          listObjects('chapter', projectId),
          // Also load story objects for context
          listObjects('basic_info', projectId),
          listObjects('character', projectId),
          listObjects('organization', projectId),
          listObjects('location', projectId),
          listObjects('lorebook', projectId),
        ]);
      } catch (error) {
        console.error('Failed to load outline data:', error);
        const errorStatus = (error as any)?.status || (error as any)?.response?.status;
        if (errorStatus !== 404) {
          showError('Data Error', 'Failed to load outline data. Please try again.');
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
        pageTitle="Outline Manager"
        availableLanguages={availableLanguages}
        currentLanguage={displayLanguage || mainLanguage}
        onLanguageChange={setDisplayLanguage}
        showTranslateAll={settings.subLanguages && settings.subLanguages.length > 0 && objectsNeedingTranslation > 0}
        translateCount={objectsNeedingTranslation}
        onTranslateAllClick={() => setShowTranslateModal(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
        mobileSubtitle="Outlines"
        showHamburger={true}
        onHamburgerClick={() => sidebarStore.toggleSidebar(projectId ?? '', 'outline')}
      />

      <div className={`workspace-content ${isChatVisible ? 'chat-visible' : ''}`}>
        <ChatPanel
          projectId={projectId ?? ''}
          mode="outlineManager"
        />

        <OutlinePanel
          globalDisplayLanguage={displayLanguage || mainLanguage}
        />
      </div>

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
        onSettingsClick={() => setIsSettingsOpen(true)}
      />

      <TranslationModal
        isOpen={showTranslateModal}
        onClose={() => setShowTranslateModal(false)}
        projectId={projectId || ''}
        onComplete={handleTranslateComplete}
        allowedObjectTypes={['outline', 'act', 'chapter']}
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
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default OutlineManager;
