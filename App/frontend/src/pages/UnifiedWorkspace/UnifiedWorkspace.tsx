import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore, type SimplifiedProjectObjects } from '../../store/unifiedObjectStore';
import { useNovelEditorStore } from '../../store/novelEditorStore';
import { useSettings } from '../../store/settingsStore';
import { useDisplayLanguageStore } from '../../store/displayLanguageStore';
import { alert as showAlert } from '../../store/dialogStore';
import { translationService } from '../../api/unifiedObjectService';
import { bootstrapProjectRuntime } from '../../runtime/projectRuntimeBootstrap';
import { normalizeBasicInfoData } from '../../utils/basicInfo';
import type { StoryEntityObject, OutlineObject } from '../../types/unifiedObject';

import SettingsModal from '../../components/SettingsModal/SettingsModal';
import TranslationModal from '../../components/Modal/TranslationModal';
import AgentPanel from '../workspace/components/AgentPanel';
import ProjectHomePanel, { type ProjectHomeTab } from '../workspace/components/ProjectHomePanel';
import ProjectHomeSidebar from '../workspace/components/ProjectHomeSidebar';
import StoryEntityPanel from '../workspace/components/StoryEntityPanel';
import OutlinePanel from '../outlinemanager/components/OutlinePanel';
import NovelEditorPanel from '../noveleditor/components/NovelEditorPanel';
import WorkspaceConfigPanel from './components/WorkspaceConfigPanel';
import EntityFolderSidebar from '../../components/StoryEntityExplorer/EntityFolderSidebar';
import { PageHeader, MobileFooter } from '../../components/layout';

import { useWorkspaceSubPage, type SubPageType } from './hooks/useWorkspaceSubPage';

import './UnifiedWorkspace.css';
import '../workspace/styles/AgentPanel.css';
import '../workspace/styles/AgentHeader.css';
import '../workspace/styles/AgentMessages.css';
import '../workspace/styles/MessageEdit.css';
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
    case 'config':
      return 'config';
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
  const refreshProjectObjects = useUnifiedObjectStore((state) => state.refreshProjectObjects);
  const changeRevision = useUnifiedObjectStore(state => state.changeRevision);

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

  // NovelEditor objects state
  const [projectObjects, setProjectObjects] = useState<SimplifiedProjectObjects>({
    basicInfo: null,
    storyEntities: [],
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
  }, [refreshTranslationCount, changeRevision]);

  // Selected chapter for novel-editor
  const selectedChapterId = selectedChapterByProject[projectId ?? '']
    ?? localStorage.getItem(`selectedChapter_${projectId ?? ''}`)
    ?? undefined;

  const selectedChapter = useMemo(() => {
    if (!selectedChapterId) return null;
    const chapter = unifiedObjects[selectedChapterId];
    if (!chapter || chapter.type !== 'outline' || chapter.kind !== 'chapter') return null;

    const langData = chapter.data[currentDisplayLanguage] || chapter.data[mainLanguage] || chapter.data[Object.keys(chapter.data)[0]] || {};

    return {
      id: chapter.id,
      name: langData.name || '',
      description: langData.description || '',
      order: chapter.metadata.position || 0,
      actId: chapter.metadata.parent_id || '',
    };
  }, [selectedChapterId, unifiedObjects, currentDisplayLanguage, mainLanguage]);

  const hasChapters = projectObjects.outline.outlines.some(outline => outline.acts.some(act => act.chapters.length > 0));

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
        await refreshProjectObjects(projectId, [
          'basic_info',
          'story_entity',
          'outline',
        ]);
      } catch (error) {
        console.error('Failed to load objects:', error);
        const errorStatus = (error as any)?.status || (error as any)?.response?.status;
        if (errorStatus !== 404) {
          showAlert({ title: 'Data Error', message: 'Failed to load objects. Please try again.' });
        }
      }
    };

    populateStoreCache();
  }, [projectId, refreshProjectObjects]);

  // Build objects for NovelEditor (when in novel-editor mode)
  useEffect(() => {
    if (!projectId || currentSubPage !== 'novel-editor') return;

    setIsOutlineInitialized(false);
    const activeProjectId = projectId;
    let isActive = true;

    const buildProjectObjects = async () => {
      try {
        const [basicInfoList, storyEntities, outlineItems] = await Promise.all([
          listObjects('basic_info', projectId),
          listObjects('story_entity', projectId),
          listObjects('outline', projectId),
        ]);

        const basicInfo = basicInfoList.length > 0 ? (() => {
          const data = normalizeBasicInfoData(getDataForLanguage(basicInfoList[0], mainLanguage));
          return {
            id: basicInfoList[0].id,
            title: data.title,
            logline: data.logline,
            genres: data.genres,
            tags: data.tags,
          };
        })() : null;

        const storyEntityItems = storyEntities.filter(
          (item): item is StoryEntityObject => item.type === 'story_entity'
        );
        const outlineNodes = outlineItems.filter(
          (item): item is OutlineObject => item.type === 'outline'
        );

        const outlines = outlineNodes
          .filter((item): item is OutlineObject => item.kind === 'outline')
          .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));
        const acts = outlineNodes
          .filter((item): item is OutlineObject => item.kind === 'act')
          .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));
        const chapters = outlineNodes
          .filter((item): item is OutlineObject => item.kind === 'chapter')
          .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));

        // Build outline hierarchy: Outline > Acts > Chapters
        const outlineData = {
          outlines: outlines
            .map(outline => {
              const oData = getDataForLanguage(outline, mainLanguage);
              const outlineActs = acts
                .filter(act => act.metadata.parent_id === outline.id)
                .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));
              return {
                id: outline.id,
                name: oData.name || '',
                description: oData.description || '',
                content: oData.content || '',
                position: outline.metadata.position || 0,
                acts: outlineActs.map(act => {
                  const actData = getDataForLanguage(act, mainLanguage);
                  return {
                    id: act.id,
                    name: actData.name || '',
                    description: actData.description || '',
                    content: actData.content || '',
                    position: act.metadata.position || 0,
                    parentId: act.metadata.parent_id || '',
                    chapters: chapters
                      .filter(ch => ch.metadata.parent_id === act.id)
                      .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0))
                      .map(chapter => {
                        const chapterData = getDataForLanguage(chapter, mainLanguage);
                        return {
                          id: chapter.id,
                          name: chapterData.name || '',
                          description: chapterData.description || '',
                          content: chapterData.content || '',
                          position: chapter.metadata.position || 0,
                          parentId: chapter.metadata.parent_id || '',
                        };
                      }),
                  };
                }),
              };
            }),
        };

        if (isActive) {
          setProjectObjects({
            basicInfo,
            storyEntities: storyEntityItems.map((entity) => {
              const data = getDataForLanguage(entity, mainLanguage);
              return {
                id: entity.id,
                kind: entity.kind,
                name: data.name || '',
                description: data.description || '',
                content: data.content || '',
              };
            }),
            characters: storyEntityItems
              .filter((entity) => entity.kind === 'character')
              .map((entity) => {
                const data = getDataForLanguage(entity, mainLanguage);
                return { id: entity.id, name: data.name || '', description: data.description || '', content: data.content || '' };
              }),
            organizations: storyEntityItems
              .filter((entity) => entity.kind === 'organization')
              .map((entity) => {
                const data = getDataForLanguage(entity, mainLanguage);
                return { id: entity.id, name: data.name || '', description: data.description || '', content: data.content || '' };
              }),
            locations: storyEntityItems
              .filter((entity) => entity.kind === 'location')
              .map((entity) => {
                const data = getDataForLanguage(entity, mainLanguage);
                return { id: entity.id, name: data.name || '', description: data.description || '', content: data.content || '' };
              }),
            lorebook: storyEntityItems
              .filter((entity) => entity.kind === 'lorebook')
              .map((entity) => {
                const data = getDataForLanguage(entity, mainLanguage);
                return { id: entity.id, name: data.name || '', description: data.description || '', content: data.content || '' };
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
        console.error('Failed to load objects:', error);
      } finally {
        if (isActive) {
          setIsOutlineInitialized(true);
        }
      }
    };

    buildProjectObjects();
    return () => {
      isActive = false;
    };
  }, [projectId, currentSubPage, listObjects, mainLanguage, getSelectedChapterId, selectChapter]);

  // Fetch agents when projectId changes
  useEffect(() => {
    if (!projectId) return;

    fetchAgents(projectId).catch(error => {
      console.error('Failed to fetch agents:', error);
      showAlert({ title: 'Data Error', message: 'Failed to load agents. Please try again.' });
    });
  }, [projectId, fetchAgents]);

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
      case 'project-home':
        return projectHomeTab === 'basicInfo' ? 'Basic Info' : 'Guidelines';
      case 'story-entity':
        return t('unifiedWorkspace.mobileSubtitle.storyEntities', 'Story Entities');
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
