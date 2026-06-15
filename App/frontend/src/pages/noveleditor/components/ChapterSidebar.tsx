import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnifiedObjectStore, useObjectCollectionStatus } from '../../../store/unifiedObjectStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import type { ActObject, ChapterObject, ManuscriptObject, OutlineObject } from '../../../types/unifiedObject';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { IconButton } from '../../../components/IconButton';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { Close, ChevronDown } from '../../../components/icons';
import { SkeletonList } from '../../../components/common/Skeleton';
import { sortOutlineObjects } from '../../../utils/outlineOrdering';
import './ChapterSidebar.css';

interface ChapterSidebarProps {
  projectId: string;
  selectedChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  displayLanguage: string;
}

const ChapterSidebar: React.FC<ChapterSidebarProps> = ({
  projectId,
  selectedChapterId,
  onSelectChapter,
  displayLanguage,
}) => {
  const { t } = useTranslation();
  const store = useUnifiedObjectStore();
  const projectionObjects = useUnifiedObjectStore(
    (state) => state.getObjectsForProject(projectId, displayLanguage),
  );
  const { loading: chaptersLoading, hydrated: chaptersHydrated } = useObjectCollectionStatus(
    projectId,
    ['outline', 'manuscript'],
    displayLanguage,
  );
  const showSkeleton = chaptersLoading && !chaptersHydrated;
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  const { selectOutline, getSelectedOutlineId, syncOutlineFromStorage } = useNovelEditorStore();

  // Sync outline selection from localStorage on mount (avoids setState during render)
  useEffect(() => {
    syncOutlineFromStorage(projectId);
  }, [projectId, syncOutlineFromStorage]);

  const handleClose = () => {
    closeSidebar(projectId);
  };

  const getLocalizedData = <T extends { data: Record<string, any> }>(obj: T, fallback: any) => {
    void displayLanguage;
    void mainLanguage;
    return obj.data ?? fallback;
  };

  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const [expandCount, setExpandCount] = useState<Record<string, number>>({});

  // Get selected outline from store
  const selectedOutlineId = getSelectedOutlineId(projectId);

  const toggleAct = (actId: string) => {
    const newCollapsed = new Set(collapsedActs);
    if (newCollapsed.has(actId)) {
      // Expanding - increment counter to trigger animation
      newCollapsed.delete(actId);
      setExpandCount(prev => ({ ...prev, [actId]: (prev[actId] || 0) + 1 }));
    } else {
      newCollapsed.add(actId);
    }
    setCollapsedActs(newCollapsed);
  };

  // Load data
  useEffect(() => {
    const loadOutlineData = async () => {
      if (!projectId) return;
      try {
        await store.listObjects('outline', projectId, displayLanguage);
        await store.listObjects('manuscript', projectId, displayLanguage);
      } catch (error) {
        console.error('Failed to load outline data:', error);
      }
    };
    loadOutlineData();
  }, [displayLanguage, projectId, store]);

  // Get outlines for dropdown
  const outlines = useMemo(() => {
    return sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'outline' && obj.metadata?.project_id === projectId)
      )
    );
  }, [projectId, projectionObjects]);

  useEffect(() => {
    if (outlines.length === 0) return;
    if (!selectedOutlineId || !outlines.some((outline) => outline.id === selectedOutlineId)) {
      selectOutline(projectId, outlines[0].id);
    }
  }, [outlines, projectId, selectOutline, selectedOutlineId]);

  // Get selected outline
  const selectedOutline = useMemo(() => {
    if (!selectedOutlineId) return outlines[0] || null;
    return outlines.find(o => o.id === selectedOutlineId) || outlines[0] || null;
  }, [outlines, selectedOutlineId]);

  const { acts, chaptersByAct } = useMemo(() => {
    const loadedActs = sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is ActObject =>
          Boolean(
            obj
            && obj.type === 'outline'
            && obj.kind === 'act'
            && obj.metadata?.project_id === projectId
            && (!selectedOutlineId || obj.metadata.parent_id === selectedOutlineId)
          )
      )
    );
    const loadedChapters = sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is ChapterObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'chapter' && obj.metadata?.project_id === projectId)
      )
    );

    const grouped = loadedActs.reduce((acc, act) => {
      acc[act.id] = loadedChapters.filter(c => c.metadata.parent_id === act.id);
      return acc;
    }, {} as Record<string, ChapterObject[]>);

    return { acts: loadedActs, chaptersByAct: grouped };
  }, [projectId, projectionObjects, selectedOutlineId]);

  // Get selected outline name
  const selectedOutlineName = selectedOutline
    ? getLocalizedData(selectedOutline, { name: t('chapterSidebar.untitledOutline') }).name || t('chapterSidebar.untitledOutline')
    : t('chapterSidebar.timeline');

  const headerContent = (
    <div className="chapter-sidebar-header">
      {outlines.length > 1 ? (
        <DropdownMenu
          trigger={
            <div className="header-title-group clickable">
              <h3 className="header-title">{selectedOutlineName}</h3>
              <span className="header-subtitle">
                {t('chapterSidebar.storyOutline')}
                <ChevronDown size="xs" className="header-chevron" />
              </span>
            </div>
          }
          align="left"
        >
          {outlines.map((outline) => {
            const outlineData = getLocalizedData(outline, { name: t('chapterSidebar.untitledOutline') });
            const isSelected = outline.id === selectedOutlineId;
            return (
              <DropdownItem
                key={outline.id}
                label={outlineData.name || t('chapterSidebar.untitledOutline')}
                onClick={() => selectOutline(projectId, outline.id)}
                className={isSelected ? 'is-selected' : ''}
              />
            );
          })}
        </DropdownMenu>
      ) : (
        <div className="header-title-group">
          <h3 className="header-title">{selectedOutlineName}</h3>
          <span className="header-subtitle">{t('chapterSidebar.storyOutline')}</span>
        </div>
      )}
      <IconButton
        icon={<Close size="sm" />}
        onClick={handleClose}
        title={t('chapterSidebar.closeSidebar')}
        className="close-button"
        size="sm"
        variant="ghost"
      />
    </div>
  );

  return (
    <BaseSidebar
      id="chapter"
      projectId={projectId}
      position="right"
      className="chapter-sidebar"
      header={headerContent}
      onClose={handleClose}
    >
      <div className="timeline-container">
        <div className="timeline-line"></div>
        {showSkeleton ? (
          <div style={{ padding: 'var(--spacing-md)' }}>
            <SkeletonList rows={5} />
          </div>
        ) : acts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-content">
              <span className="empty-icon">📝</span>
              <h4>{t('chapterSidebar.emptyState.noContentYet')}</h4>
              <p>{t('chapterSidebar.emptyState.createFirstAct')}</p>
            </div>
          </div>
        ) : (
          acts.map((act, actIndex) => {
            const actData = getLocalizedData(act, { name: t('chapterSidebar.untitledAct'), description: '' });
            const actChapters = chaptersByAct[act.id] || [];
            const isCollapsed = collapsedActs.has(act.id);

            // Calculate global chapter offset (sum of chapters in previous acts)
            const globalChapterOffset = acts
              .slice(0, actIndex)
              .reduce((sum, prevAct) => sum + (chaptersByAct[prevAct.id]?.length || 0), 0);

            return (
              <div
                key={act.id}
                className={`act-group ${isCollapsed ? 'is-collapsed' : ''}`}
                style={{ '--anim-index': actIndex } as React.CSSProperties}
              >
                <div
                  className="act-header"
                  onClick={() => toggleAct(act.id)}
                >
                  <div className="timeline-node act-node">
                    <span className="node-inner"></span>
                  </div>
                  <div className="act-header-content">
                    <span className="act-overline">{t('chapterSidebar.act')} {actIndex + 1}</span>
                    <div className="act-title-row">
                      <h4 className="act-title">{actData.name || t('chapterSidebar.untitledAct')}</h4>
                      <div className="act-toggle-icon">
                        <span className="toggle-chevron"></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="chapter-group-wrapper">
                  <div className="chapter-group" key={`${act.id}-${expandCount[act.id] || 0}`}>
                    {actChapters.length > 0 ? (
                      actChapters.map((chapter, chapIndex) => {
                        const chapData = getLocalizedData(chapter, { name: t('chapterSidebar.untitledChapter'), description: '' });
                        const manuscript = store.getManuscriptByChapterId(chapter.id) as ManuscriptObject | null;
                        const manuData = manuscript ? getLocalizedData(manuscript, { wordCount: 0 }) : { wordCount: 0 };
                        const isSelected = selectedChapterId === chapter.id;

                        return (
                          <div
                            key={chapter.id}
                            className="chapter-item-container"
                            style={{ '--chapter-index': chapIndex } as React.CSSProperties}
                          >
                            <div className="timeline-node chapter-node"></div>
                            <button
                              className={`chapter-card ${isSelected ? 'is-active' : ''}`}
                              onClick={() => onSelectChapter(chapter.id)}
                            >
                              <div className="chapter-card-header">
                                <span className="chapter-number">Ch.{globalChapterOffset + chapIndex + 1}</span>
                                <span className="word-count">{manuData.wordCount || 0}w</span>
                              </div>
                              <div className="chapter-card-main">
                                <span className="chapter-name">{chapData.name || t('chapterSidebar.untitled')}</span>
                              </div>
                              <div className="chapter-card-description-wrapper">
                                <div className="chapter-card-description">
                                  {chapData.description || t('chapterSidebar.noDescription')}
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="chapter-empty-placeholder">
                        <div className="timeline-node chapter-node empty"></div>
                        <span className="empty-text">{t('chapterSidebar.noChapters')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </BaseSidebar>
  );
};

export default ChapterSidebar;
