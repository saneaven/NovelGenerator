import React, { useState, useEffect } from 'react';
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
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const handleClose = () => {
    closeSidebar(projectId);
  };

  // Helper to get data for language with fallback (displayLanguage -> mainLanguage -> first available)
  const getActData = (act: ActObject) => {
    if (act.data[displayLanguage]) return act.data[displayLanguage];
    if (act.data[mainLanguage]) return act.data[mainLanguage];
    const available = Object.keys(act.data);
    return available.length > 0 ? act.data[available[0]] : { name: '', description: '' };
  };

  const getChapterData = (chapter: ChapterObject) => {
    if (chapter.data[displayLanguage]) return chapter.data[displayLanguage];
    if (chapter.data[mainLanguage]) return chapter.data[mainLanguage];
    const available = Object.keys(chapter.data);
    return available.length > 0 ? chapter.data[available[0]] : { name: '', description: '' };
  };

  const getManuscriptData = (manuscript: ManuscriptObject) => {
    if (manuscript.data[displayLanguage]) return manuscript.data[displayLanguage];
    if (manuscript.data[mainLanguage]) return manuscript.data[mainLanguage];
    const available = Object.keys(manuscript.data);
    return available.length > 0 ? manuscript.data[available[0]] : { content: '', wordCount: 0 };
  };
  const [actIds, setActIds] = useState<string[]>([]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);

  // Load acts and chapters on mount
  useEffect(() => {
    const loadOutlineData = async () => {
      if (!projectId) return;

      try {
        // Load all acts for this project
        const acts = await store.listObjects('act', projectId);
        const sortedActIds = acts
          .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
          .map(act => act.id);
        setActIds(sortedActIds);

        // Load all chapters for this project
        const chapters = await store.listObjects('chapter', projectId);
        const sortedChapterIds = chapters
          .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0))
          .map(chapter => chapter.id);
        setChapterIds(sortedChapterIds);

        // Also load manuscript objects
        await store.listObjects('manuscript', projectId);
      } catch (error) {
        console.error('Failed to load outline data:', error);
      }
    };

    loadOutlineData();
  }, [projectId]);

  // Get acts and chapters from store
  const acts = actIds
    .map(id => store.objects[id] as ActObject)
    .filter(Boolean);

  const chapters = chapterIds
    .map(id => store.objects[id] as ChapterObject)
    .filter(Boolean);

  // Get chapters for a specific act
  const getChaptersForAct = (actId: string): ChapterObject[] => {
    return chapters
      .filter(chapter => chapter.metadata.act_id === actId)
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  };

  // Get manuscript from unified store
  const getManuscript = (chapterId: string): ManuscriptObject | null => {
    return store.getManuscriptByChapterId(chapterId) as ManuscriptObject | null;
  };

  const sidebarHeader = (
    <div className="chapter-sidebar-header">
      <h3>Chapters</h3>
      <IconButton
        icon={<Close size="sm" />}
        onClick={handleClose}
        title="Close sidebar"
        size="sm"
      />
    </div>
  );

  if (acts.length === 0) {
    return (
      <BaseSidebar
        id="chapter"
        projectId={projectId}
        position="right"
        className="chapter-sidebar"
        header={
          <div className="chapter-sidebar-header">
            <h3>Chapters</h3>
            <IconButton
              icon={<Close size="sm" />}
              onClick={handleClose}
              title="Close chapter list"
              size="sm"
            />
          </div>
        }
        onClose={handleClose}
      >
        <div className="chapter-sidebar-content">
          <div className="no-chapters-message">
            <p>No chapters available.</p>
            <p>Create acts and chapters in the Workspace first.</p>
          </div>
        </div>
      </BaseSidebar>
    );
  }

  return (
    <BaseSidebar
      id="chapter"
      projectId={projectId}
      position="right"
      className="chapter-sidebar"
      header={sidebarHeader}
      onClose={handleClose}
    >
      <div className="chapter-sidebar-content">
        {acts.map((act, actIndex) => {
          const actChapters = getChaptersForAct(act.id);
          const actData = getActData(act);

          return (
            <div key={act.id} className="act-section">
              <div className="act-header">
                <div className="act-info">
                  <h4 className="act-title">
                    Act {actIndex + 1}: {actData.name || 'Untitled Act'}
                  </h4>
                  {actData.description && (
                    <p className="act-description">{actData.description}</p>
                  )}
                </div>
              </div>

              <div className="chapters-list">
                {actChapters.length > 0 ? (
                  actChapters.map((chapter, chapterIndex) => {
                    const manuscript = getManuscript(chapter.id);
                    const manuscriptData = manuscript ? getManuscriptData(manuscript) : null;
                    const wordCount = manuscriptData?.wordCount || 0;
                    const isSelected = selectedChapterId === chapter.id;
                    const chapterData = getChapterData(chapter);

                    return (
                      <div
                        key={chapter.id}
                        className={`chapter-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => onSelectChapter(chapter.id)}
                      >
                        <div className="chapter-header">
                          <div className="chapter-title">
                            <span className="chapter-number">
                              Chapter {chapterIndex + 1}
                            </span>
                            <span className="chapter-name">
                              {chapterData.name || 'Untitled Chapter'}
                            </span>
                          </div>
                          <div className="chapter-meta">
                            <span className="word-count">
                              {wordCount} words
                            </span>
                          </div>
                        </div>
                        {chapterData.description && (
                          <div className="chapter-description">
                            {chapterData.description}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="no-chapters">
                    <span className="empty-message">No chapters in this act</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </BaseSidebar>
  );
};

export default ChapterSidebar;
