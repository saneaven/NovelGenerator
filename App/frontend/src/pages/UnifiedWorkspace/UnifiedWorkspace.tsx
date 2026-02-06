import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore, type SimplifiedStoryObjects } from '../../store/unifiedObjectStore';
import { useNovelEditorStore } from '../../store/novelEditorStore';
import { useSettings } from '../../store/settingsStore';
import { useDisplayLanguageStore } from '../../store/displayLanguageStore';
import { useErrorStore } from '../../store/errorStore';
import { translationService } from '../../api/unifiedObjectService';

import ErrorModal from '../../components/Modal/ErrorModal';
import SettingsModal from '../../components/SettingsModal/SettingsModal';
import TranslationModal from '../../components/Modal/TranslationModal';
import AgentPanel from '../workspace/components/AgentPanel';
import StoryObjectPanel from '../workspace/components/StoryObjectPanel';
import OutlinePanel from '../outlinemanager/components/OutlinePanel';
import NovelEditorPanel from '../noveleditor/components/NovelEditorPanel';
import WorkspaceTabsSidebar from '../workspace/components/WorkspaceTabsSidebar';
import WorkspaceConfigPanel from './components/WorkspaceConfigPanel';
import { PageHeader, MobileFooter } from '../../components/layout';

import { useWorkspaceSubPage, type SubPageType } from './hooks/useWorkspaceSubPage';
import { useStoryObjectTab } from '../workspace/hooks/useStoryObjectTab';

import './UnifiedWorkspace.css';
import '../workspace/styles/AgentPanel.css';
import '../workspace/styles/AgentHeader.css';
import '../workspace/styles/AgentMessages.css';
import '../workspace/styles/MessageEdit.css';
import '../workspace/styles/AgentInput.css';
import '../workspace/styles/MessageEditCards.css';
import '../../components/Agent/MobileAgent.css';

// Tab label keys for mobile subtitle (story-object mode) - will be localized in component
const tabLabelKeys: Record<string, string> = {
  basicInfo: 'storyObjectPanel.tabs.basicInfo',
  characters: 'storyObjectPanel.tabs.characters',
  organizations: 'storyObjectPanel.tabs.organizations',
  locations: 'storyObjectPanel.tabs.locations',
  lorebook: 'storyObjectPanel.tabs.lorebook',
  guidelines: 'storyObjectPanel.tabs.guidelines',
};

// Get agent mode from sub-page
function getAgentMode(subPage: SubPageType): 'storyObject' | 'outlineManager' | 'novelEditor' {
  switch (subPage) {
    case 'story-object':
      return 'storyObject';
    case 'outline-manager':
      return 'outlineManager';
    case 'novel-editor':
      return 'novelEditor';
    case 'config':
      return 'storyObject';
  }
}

// Get sidebar type from sub-page
function getSidebarType(subPage: SubPageType): string {
  switch (subPage) {
    case 'story-object':
      return 'workspace-tabs';
    case 'outline-manager':
      return 'outline';
    case 'novel-editor':
      return 'chapter';
    case 'config':
      return 'workspace-tabs';
  }
}

const UnifiedWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const { projectId, subPage: urlSubPage } = useParams<{ projectId: string; subPage?: string }>();
  const { currentSubPage, navigateToSubPage } = useWorkspaceSubPage(projectId, urlSubPage);

  const { getCurrentProject, fetchProjects, projects, isLoading: projectsLoading, setCurrentProject } = useProjectStore();
  const { fetchAgents } = useAgentStore();
  const unifiedObjects = useUnifiedObjectStore(state => state.objects);
  const listObjects = useUnifiedObjectStore(state => state.listObjects);

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

  // Error handling
  const { currentError, showError, hideError } = useErrorStore();

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

  // Sync agent mode when sub-page changes
  useEffect(() => {
    if (projectId) {
      useAgentUIStore.getState().setMode(projectId, getAgentMode(currentSubPage));
    }
  }, [projectId, currentSubPage]);

  // Get current agent mode from store (subscribe to changes)
  const currentAgentMode = useAgentUIStore(
    (state) => state.modeByProject[projectId ?? ''] ?? getAgentMode(currentSubPage)
  );

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Story object tab state (for mobile subtitle)
  const { activeTab: activeStoryObjectTab } = useStoryObjectTab();

  // Translation modal state
  const [showTranslateModal, setShowTranslateModal] = useState(false);

  // Translation count (missing any sub-language)
  const [objectsNeedingTranslation, setObjectsNeedingTranslation] = useState(0);

  // NovelEditor story objects state
  const [storyObjects, setStoryObjects] = useState<SimplifiedStoryObjects>({
    basicInfo: null,
    characters: [],
    organizations: [],
    locations: [],
    lorebook: [],
    outline: { outlines: [] },
  });
  const [isOutlineInitialized, setIsOutlineInitialized] = useState(false);

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

  // Calculate count of objects needing translation (not tied to current sub-page)
  useEffect(() => {
    if (!projectId || !subLanguages || subLanguages.length === 0) {
      setObjectsNeedingTranslation(0);
      return;
    }

    let cancelled = false;

    void translationService.getProjectTranslationStatus(projectId, subLanguages)
      .then((result) => {
        if (cancelled) return;
        const count = result.translation_status.filter(s => s.missing_languages.length > 0).length;
        setObjectsNeedingTranslation(count);
      })
      .catch((err) => {
        console.error('Failed to fetch translation status:', err);
        if (!cancelled) {
          setObjectsNeedingTranslation(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, subLanguages]);

  // Selected chapter for novel-editor
  const selectedChapterId = selectedChapterByProject[projectId ?? '']
    ?? localStorage.getItem(`selectedChapter_${projectId ?? ''}`)
    ?? undefined;

  const selectedChapter = useMemo(() => {
    if (!selectedChapterId) return null;
    const chapter = unifiedObjects[selectedChapterId];
    if (!chapter || chapter.type !== 'chapter') return null;

    const langData = chapter.data[currentDisplayLanguage] || chapter.data[mainLanguage] || chapter.data[Object.keys(chapter.data)[0]] || {};

    return {
      id: chapter.id,
      name: langData.name || '',
      description: langData.description || '',
      order: chapter.metadata.order || 0,
      actId: chapter.metadata.act_id || '',
    };
  }, [selectedChapterId, unifiedObjects, currentDisplayLanguage, mainLanguage]);

  const hasChapters = storyObjects.outline.outlines.some(outline => outline.acts.some(act => act.chapters.length > 0));

  // Helper to get data for a specific language
  const getDataForLanguage = (obj: any, language: string): Record<string, any> => {
    if (obj.data[language]) return obj.data[language];
    const available = Object.keys(obj.data);
    if (available.length > 0) return obj.data[available[0]];
    return {};
  };

  // Set current project when projectId changes
  useEffect(() => {
    if (projectId) {
      setCurrentProject(projectId);
    }
  }, [projectId, setCurrentProject]);

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
          listObjects('outline', projectId),
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

  // Build story objects for NovelEditor (when in novel-editor mode)
  useEffect(() => {
    if (!projectId || currentSubPage !== 'novel-editor') return;

    setIsOutlineInitialized(false);
    const activeProjectId = projectId;
    let isActive = true;

    const buildStoryObjects = async () => {
      try {
        const [basicInfoList, characters, organizations, locations, lorebook, outlines, acts, chapters] = await Promise.all([
          listObjects('basic_info', projectId),
          listObjects('character', projectId),
          listObjects('organization', projectId),
          listObjects('location', projectId),
          listObjects('lorebook', projectId),
          listObjects('outline', projectId),
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

        // Build outline hierarchy: Outline > Acts > Chapters
        const outlineData = {
          outlines: outlines
            .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
            .map(outline => {
              const oData = getDataForLanguage(outline, mainLanguage);
              const outlineActs = acts
                .filter(act => act.metadata.outline_id === outline.id)
                .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
              return {
                id: outline.id,
                name: oData.name || '',
                description: oData.description || '',
                content: oData.content || '',
                order: outline.metadata.order || 0,
                acts: outlineActs.map(act => {
                  const actData = getDataForLanguage(act, mainLanguage);
                  return {
                    id: act.id,
                    name: actData.name || '',
                    description: actData.description || '',
                    content: actData.content || '',
                    order: act.metadata.order || 0,
                    outlineId: act.metadata.outline_id || '',
                    chapters: chapters
                      .filter(ch => ch.metadata.act_id === act.id)
                      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
                      .map(chapter => {
                        const chapterData = getDataForLanguage(chapter, mainLanguage);
                        return {
                          id: chapter.id,
                          name: chapterData.name || '',
                          description: chapterData.description || '',
                          content: chapterData.content || '',
                          order: chapter.metadata.order || 0,
                          actId: chapter.metadata.act_id || '',
                        };
                      }),
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
              return { id: ch.id, name: data.name || '', description: data.description || '', content: data.content || '' };
            }),
            organizations: organizations.map(org => {
              const data = getDataForLanguage(org, mainLanguage);
              return { id: org.id, name: data.name || '', description: data.description || '', content: data.content || '' };
            }),
            locations: locations.map(loc => {
              const data = getDataForLanguage(loc, mainLanguage);
              return { id: loc.id, name: data.name || '', description: data.description || '', content: data.content || '' };
            }),
            lorebook: lorebook.map(entry => {
              const data = getDataForLanguage(entry, mainLanguage);
              return { id: entry.id, name: data.name || '', description: data.description || '', content: data.content || '' };
            }),
            outline: outlineData,
          });

          if (activeProjectId) {
            const allActs = outlineData.outlines.flatMap(o => o.acts);
            const firstActWithChapters = allActs.find(act => act.chapters.length > 0);
            const firstChapter = firstActWithChapters?.chapters[0];
            if (firstChapter) {
              const existingSelection = getSelectedChapterId(activeProjectId);
              const selectionStillExists = existingSelection
                ? allActs.some(act => act.chapters.some(ch => ch.id === existingSelection))
                : false;

              if (!selectionStillExists) {
                selectChapter(activeProjectId, firstChapter.id);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load story objects:', error);
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
  }, [projectId, currentSubPage, listObjects, mainLanguage, getSelectedChapterId, selectChapter]);

  // Fetch agents when projectId changes
  useEffect(() => {
    if (!projectId) return;

    fetchAgents(projectId).catch(error => {
      console.error('Failed to fetch agents:', error);
      showError('Data Error', 'Failed to load agents. Please try again.');
    });
  }, [projectId, fetchAgents, showError]);

  const currentProject = getCurrentProject();

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
      case 'story-object':
        return tabLabelKeys[activeStoryObjectTab] ? t(tabLabelKeys[activeStoryObjectTab]) : activeStoryObjectTab;
      case 'outline-manager':
        return t('unifiedWorkspace.mobileSubtitle.outlines');
      case 'novel-editor':
        return selectedChapter?.name || t('unifiedWorkspace.mobileSubtitle.noChapterSelected');
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
          mode={currentAgentMode}
        />

        {currentSubPage === 'story-object' && (
          <StoryObjectPanel
            globalDisplayLanguage={currentDisplayLanguage}
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

        {currentSubPage === 'config' && (
          <WorkspaceConfigPanel
            projectId={projectId ?? ''}
          />
        )}
      </div>

      {/* Sidebar for story-object mode */}
      {currentSubPage === 'story-object' && (
        <WorkspaceTabsSidebar
          projectId={projectId ?? ''}
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
        onClose={() => setShowTranslateModal(false)}
        projectId={projectId || ''}
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

export default UnifiedWorkspace;
