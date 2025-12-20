import React, { useState, useEffect, useMemo } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { ActObject, ChapterObject, ManuscriptObject } from '../../../types/unifiedObject';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { IconButton } from '../../../components/IconButton';
import { Close } from '../../../components/icons';
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
  const store = useUnifiedObjectStore();
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);
  const mainLanguage = useSettingsStore((state) => state.settings.mainLanguage);
  
  const handleClose = () => {
    closeSidebar(projectId);
  };

  // Helper to get data with fallback
  const getLocalizedData = <T extends { data: Record<string, any> }>(obj: T, fallback: any) => {
    if (obj.data[displayLanguage]) return obj.data[displayLanguage];
    if (obj.data[mainLanguage]) return obj.data[mainLanguage];
    const available = Object.keys(obj.data);
    return available.length > 0 ? obj.data[available[0]] : fallback;
  };

  const [actIds, setActIds] = useState<string[]>([]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const [expandCount, setExpandCount] = useState<Record<string, number>>({});

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
        const acts = await store.listObjects('act', projectId);
        setActIds(acts.sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0)).map(a => a.id));
        
        const chapters = await store.listObjects('chapter', projectId);
        setChapterIds(chapters.sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0)).map(c => c.id));
        
        await store.listObjects('manuscript', projectId);
      } catch (error) {
        console.error('Failed to load outline data:', error);
      }
    };
    loadOutlineData();
  }, [projectId, store]);

  const { acts, chaptersByAct } = useMemo(() => {
    const loadedActs = actIds.map(id => store.objects[id] as ActObject).filter(Boolean);
    const loadedChapters = chapterIds.map(id => store.objects[id] as ChapterObject).filter(Boolean);
    
    const grouped = loadedActs.reduce((acc, act) => {
      acc[act.id] = loadedChapters
        .filter(c => c.metadata.act_id === act.id)
        .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
      return acc;
    }, {} as Record<string, ChapterObject[]>);

    return { acts: loadedActs, chaptersByAct: grouped };
  }, [actIds, chapterIds, store.objects]);

  const headerContent = (
    <div className="chapter-sidebar-header">
      <div className="header-title-group">
        <h3 className="header-title">Timeline</h3>
        <span className="header-subtitle">Story Outline</span>
      </div>
      <IconButton
        icon={<Close size="sm" />}
        onClick={handleClose}
        title="Close sidebar"
        className="close-button"
        size="sm"
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
        {acts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-content">
              <span className="empty-icon">📝</span>
              <h4>No Content Yet</h4>
              <p>Create your first Act and Chapter to get started.</p>
            </div>
          </div>
        ) : (
          acts.map((act, actIndex) => {
            const actData = getLocalizedData(act, { name: 'Untitled Act', description: '' });
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
                    <span className="act-overline">ACT {actIndex + 1}</span>
                    <div className="act-title-row">
                      <h4 className="act-title">{actData.name || 'Untitled Act'}</h4>
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
                        const chapData = getLocalizedData(chapter, { name: 'Untitled Chapter', description: '' });
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
                                <span className="chapter-name">{chapData.name || 'Untitled'}</span>
                              </div>
                              <div className="chapter-card-description-wrapper">
                                <div className="chapter-card-description">
                                  {chapData.description || "No description available."}
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="chapter-empty-placeholder">
                        <div className="timeline-node chapter-node empty"></div>
                        <span className="empty-text">No chapters</span>
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
