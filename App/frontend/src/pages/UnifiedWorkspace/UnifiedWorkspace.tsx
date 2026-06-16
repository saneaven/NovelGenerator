import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useEnsureAgentSelection } from '../../data/agents';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useProjectStore } from '../../store/projectStore';
import { useProjectsQuery, useCurrentProject } from '../../data/projects';
import { useNovelEditorStore } from '../../store/novelEditorStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useSettings } from '../../data/settings';
import { useDisplayLanguageStore } from '../../store/displayLanguageStore';
import { translationService } from '../../api/unifiedObjectService';
import { bootstrapProjectRuntime } from '../../runtime/projectRuntimeBootstrap';
import { useProjectObjectsQuery } from '../../data/objects/useProjectObjectsQuery';
import { useProjectObjectsMap } from '../../data/objects/useProjectObjectsMap';

import SettingsModal from '../../components/SettingsModal/SettingsModal';
import TranslationModal from '../../components/TranslationModal';
import AgentPanel from '../workspace/components/AgentPanel';
import ProjectHomePanel, { type ProjectHomeTab } from '../workspace/components/ProjectHomePanel';
import ProjectHomeSidebar from '../workspace/components/ProjectHomeSidebar';
import StoryEntityPanel from '../workspace/components/StoryEntityPanel';
import OutlinePanel from '../outlinemanager/components/OutlinePanel';
import NovelEditorPanel from '../noveleditor/components/NovelEditorPanel';
import WorkspaceConfigPanel from './components/WorkspaceConfigPanel';
import TimelinePage from '../timeline/TimelinePage';
import EntityFolderSidebar from '../../components/StoryEntityExplorer/EntityFolderSidebar';
import { PageHeader, MobileFooter } from '../../components/layout';

import { useWorkspaceSubPage, type SubPageType } from './hooks/useWorkspaceSubPage';

import './UnifiedWorkspace.css';
import '../workspace/styles/AgentPanel.css';
import '../workspace/styles/AgentHeader.css';
import '../workspace/styles/AgentInput.css';
import '../../components/Agent/MobileAgent.css';

// Get sidebar type from sub-page
function getSidebarType(subPage: SubPageType): string {
  switch (subPage) {
    case 'project-home':
      return 'project-home';
    case 'story-entity':
      return 'story-entity-folder';
    case 'outline-manager':
      return 'outline';
    case 'novel-editor':
      return 'chapter';
    case 'timeline':
      return 'timeline';
    case 'config':
      return 'config';
  }
}

const UnifiedWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const { projectId, subPage: urlSubPage } = useParams<{ projectId: string; subPage?: string }>();
  const { currentSubPage, navigateToSubPage } = useWorkspaceSubPage(projectId, urlSubPage);

  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const projectsQuery = useProjectsQuery();
  const projectsLoading = projectsQuery.isLoading;
  const currentProject = useCurrentProject();
  useEnsureAgentSelection(projectId);
  const fetchTimeline = useTimelineStore((state) => state.fetchTimeline);
  const timelineChangeRevision = useTimelineStore((state) => state.changeRevision);
  const timelineLoadedProjectId = useTimelineStore((state) => state.loadedProjectId);
  const timelineLoadedLanguage = useTimelineStore((state) => state.loadedLanguage);

  // NovelEditor specific stores
  const selectedChapterByProject = useNovelEditorStore(state => state.selectedChapterByProject);
  const isSavingByProject = useNovelEditorStore(state => state.isSavingByProject);
  const hasUnsavedChangesByProject = useNovelEditorStore(state => state.hasUnsavedChangesByProject);
  const getSelectedChapterId = useNovelEditorStore(state => state.getSelectedChapterId);
  const selectChapter = useNovelEditorStore(state => state.selectChapter);

  // Settings
  const settings = useSettings();
  const mainLanguage = settings.mainLanguage;
  const preferredDisplayLanguage = useDisplayLanguageStore((state) => state.preferredDisplayLanguage);
  const setPreferredDisplayLanguage = useDisplayLanguageStore((state) => state.setPreferredDisplayLanguage);
  const subLanguages = settings.subLanguages;


  // UI stores - use selector to avoid re-renders when other agentUIStore properties change
  const isAgentVisibleState = useAgentUIStore(
    (state) => state.agentVisibleByProject[projectId ?? ''] ?? false
  );
  const sidebarStore = useSidebarStore();

  // Desktop/mobile detection
  const isDesktopView = typeof window !== 'undefined' && window.innerWidth > 768;
  const isAgentVisible = isDesktopView ? true : isAgentVisibleState;

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

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Project home tab state
  const [projectHomeTab, setProjectHomeTab] = useState<ProjectHomeTab>('basicInfo');

  // Story entity folder selection
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Translation modal state
  const [showTranslateModal, setShowTranslateModal] = useState(false);

  // Translation count (missing any sub-language)
  const [objectsNeedingTranslation, setObjectsNeedingTranslation] = useState(0);

  // Build available languages list
  const availableLanguages = useMemo(() => {
    const languages = [mainLanguage];
    if (subLanguages && subLanguages.length > 0) {
      languages.push(...subLanguages);
    }
    return [...new Set(languages)].filter(Boolean);
  }, [mainLanguage, subLanguages]);

  const currentDisplayLanguage = useMemo(() => {
    if (preferredDisplayLanguage && availableLanguages.includes(preferredDisplayLanguage)) {
      return preferredDisplayLanguage;
    }
    return mainLanguage;
  }, [preferredDisplayLanguage, availableLanguages, mainLanguage]);

  // Composite query: the SimplifiedProjectObjects structure (replaces the old
  // inline builder). Auto-fetches; `isLoading` is false once all collections resolve.
  const { data: projectObjects, isLoading: isOutlineLoading } = useProjectObjectsQuery(
    projectId,
    currentDisplayLanguage,
  );
  // Raw id→object map for chapter lookups (replaces the god-store selector).
  const unifiedObjects = useProjectObjectsMap(projectId, currentDisplayLanguage);

  // The outline tree is considered initialized once the composite query resolves.
  const isOutlineInitialized = !isOutlineLoading;

  // Refresh count of objects needing translation
  const refreshTranslationCount = useCallback(() => {
    if (!projectId || !subLanguages || subLanguages.length === 0) {
      setObjectsNeedingTranslation(0);
      return;
    }

    void translationService.getProjectTranslationStatus(projectId, subLanguages)
      .then((result) => {
        const count = result.translation_status.filter(s => s.missing_languages.length > 0).length;
        setObjectsNeedingTranslation(count);
      })
      .catch((err) => {
        console.error('Failed to fetch translation status:', err);
        setObjectsNeedingTranslation(0);
      });
  }, [projectId, subLanguages]);

  // Calculate count of objects needing translation (not tied to current sub-page)
  useEffect(() => {
    refreshTranslationCount();
  }, [refreshTranslationCount, timelineChangeRevision]);

  // Selected chapter for novel-editor
  const selectedChapterId = selectedChapterByProject[projectId ?? '']
    ?? localStorage.getItem(`selectedChapter_${projectId ?? ''}`)
    ?? undefined;

  const selectedChapter = useMemo(() => {
    if (!selectedChapterId) return null;
    const chapter = unifiedObjects[selectedChapterId];
    if (!chapter || chapter.type !== 'outline' || chapter.kind !== 'chapter') return null;

    const langData = chapter.data && typeof chapter.data === 'object' && !Array.isArray(chapter.data)
      ? chapter.data as Record<string, any>
      : {};

    return {
      id: chapter.id,
      name: langData.name || '',
      description: langData.description || '',
      order: chapter.metadata.position || 0,
      actId: chapter.metadata.parent_id || '',
    };
  }, [selectedChapterId, unifiedObjects, currentDisplayLanguage, mainLanguage]);

  const hasChapters = projectObjects.outline.outlines.some(outline => outline.acts.some(act => act.chapters.length > 0));

  // Set current project when projectId changes
  useEffect(() => {
    if (projectId) {
      setCurrentProject(projectId);
    }
  }, [projectId, setCurrentProject]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void bootstrapProjectRuntime(projectId).catch((error) => {
      if (cancelled) return;
      console.warn('Failed to bootstrap project runtime', { projectId, error });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    if (timelineLoadedProjectId === projectId && timelineLoadedLanguage === currentDisplayLanguage) return;

    void fetchTimeline(projectId, currentDisplayLanguage, { force: true }).catch((error) => {
      console.error('Failed to load timeline:', error);
    });
  }, [currentDisplayLanguage, fetchTimeline, projectId, timelineLoadedLanguage, timelineLoadedProjectId]);

  // Auto-select the first chapter for NovelEditor once the outline has loaded.
  // (The data itself comes from useProjectObjectsQuery above.)
  useEffect(() => {
    if (!projectId || currentSubPage !== 'novel-editor' || isOutlineLoading) return;

    const allActs = projectObjects.outline.outlines.flatMap(o => o.acts);
    const firstActWithChapters = allActs.find(act => act.chapters.length > 0);
    const firstChapter = firstActWithChapters?.chapters[0];
    if (!firstChapter) return;

    const existingSelection = getSelectedChapterId(projectId);
    const selectionStillExists = existingSelection
      ? allActs.some(act => act.chapters.some(ch => ch.id === existingSelection))
      : false;

    if (!selectionStillExists) {
      selectChapter(projectId, firstChapter.id);
    }
  }, [projectId, currentSubPage, isOutlineLoading, projectObjects, getSelectedChapterId, selectChapter]);

  // Show loading state
  if (projectsLoading && !currentProject) {
    return (
      <div className="error-container">
        <p>{t('unifiedWorkspace.loadingProject')}</p>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="error-container">
        <h2>{t('unifiedWorkspace.projectNotFound')}</h2>
        <Link to="/">{t('unifiedWorkspace.goBackHome')}</Link>
      </div>
    );
  }

  // Get mobile subtitle based on current sub-page
  const getMobileSubtitle = () => {
    switch (currentSubPage) {
      case 'project-home':
        return projectHomeTab === 'basicInfo' ? 'Basic Info' : 'Guidelines';
      case 'story-entity':
        return t('unifiedWorkspace.mobileSubtitle.storyEntities', 'Story Entities');
      case 'outline-manager':
        return t('unifiedWorkspace.mobileSubtitle.outlines');
      case 'novel-editor':
        return selectedChapter?.name || t('unifiedWorkspace.mobileSubtitle.noChapterSelected');
      case 'timeline':
        return t('unifiedWorkspace.mobileSubtitle.timeline', 'Timeline');
      case 'config':
        return t('unifiedWorkspace.mobileSubtitle.config');
    }
  };

  return (
    <div className="unified-workspace-container">
      <PageHeader
        projectName={currentProject.name}
        currentSubPage={currentSubPage}
        onSubPageChange={navigateToSubPage}
        availableLanguages={availableLanguages}
        currentLanguage={currentDisplayLanguage}
        onLanguageChange={(lang) => setPreferredDisplayLanguage(lang === mainLanguage ? null : lang)}
        showTranslateAll={subLanguages && subLanguages.length > 0 && objectsNeedingTranslation > 0}
        translateCount={objectsNeedingTranslation}
        onTranslateAllClick={() => setShowTranslateModal(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
        mobileSubtitle={getMobileSubtitle()}
        showHamburger={currentSubPage !== 'config'}
        onHamburgerClick={() => sidebarStore.toggleSidebar(projectId ?? '', getSidebarType(currentSubPage))}
        showSaveIndicator={currentSubPage === 'novel-editor'}
        saveStatus={
          currentSubPage === 'novel-editor'
            ? isSavingByProject[projectId ?? '']
              ? 'saving'
              : hasUnsavedChangesByProject[projectId ?? '']
                ? 'unsaved'
                : 'saved'
            : undefined
        }
      />

      <div className={`unified-workspace-content ${isAgentVisible ? 'agent-visible' : ''}`}>
        <AgentPanel
          projectId={projectId ?? ''}
          surface={currentSubPage}
          displayLanguage={currentDisplayLanguage}
        />

        {currentSubPage === 'project-home' && (
          <ProjectHomePanel
            globalDisplayLanguage={currentDisplayLanguage}
            activeTab={projectHomeTab}
            onTabChange={setProjectHomeTab}
          />
        )}

        {currentSubPage === 'story-entity' && (
          <StoryEntityPanel
            globalDisplayLanguage={currentDisplayLanguage}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
          />
        )}

        {currentSubPage === 'outline-manager' && (
          <OutlinePanel
            globalDisplayLanguage={currentDisplayLanguage}
          />
        )}

        {currentSubPage === 'novel-editor' && (
          <NovelEditorPanel
            projectId={projectId ?? ''}
            selectedChapter={selectedChapter}
            selectedChapterId={selectedChapterId || null}
            hasChapters={hasChapters}
            chaptersInitialized={isOutlineInitialized}
            globalDisplayLanguage={currentDisplayLanguage}
            onSelectChapter={(chapterId) => selectChapter(projectId ?? '', chapterId)}
          />
        )}

        {currentSubPage === 'timeline' && (
          <TimelinePage
            globalDisplayLanguage={currentDisplayLanguage}
          />
        )}

        {currentSubPage === 'config' && (
          <WorkspaceConfigPanel
            projectId={projectId ?? ''}
          />
        )}
      </div>

      {currentSubPage === 'project-home' && (
        <ProjectHomeSidebar
          projectId={projectId ?? ''}
          activeTab={projectHomeTab}
          onTabChange={setProjectHomeTab}
        />
      )}

      {currentSubPage === 'story-entity' && (
        <EntityFolderSidebar
          projectId={projectId ?? ''}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          displayLanguage={currentDisplayLanguage}
        />
      )}

      <MobileFooter
        isAgentVisible={isAgentVisible}
        onAgentToggle={() => {
          if (isAgentVisible) {
            useAgentUIStore.getState().setAgentVisible(projectId ?? '', false);
          } else {
            useAgentUIStore.getState().toggleAgentVisible(projectId ?? '');
          }
          sidebarStore.closeSidebar(projectId ?? '');
        }}
        onSettingsClick={() => setIsSettingsOpen(true)}
      />

      <TranslationModal
        isOpen={showTranslateModal}
        onClose={() => { setShowTranslateModal(false); refreshTranslationCount(); }}
        projectId={projectId || ''}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default UnifiedWorkspace;
