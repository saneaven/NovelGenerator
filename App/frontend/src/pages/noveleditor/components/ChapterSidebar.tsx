import React, { useState, useEffect } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useNovelStore } from '../../../store/novelStore';
import type { ActObject, ChapterObject } from '../../../types/unifiedObject';

interface ChapterSidebarProps {
  projectId: string;
  isVisible: boolean;
  onToggle: () => void;
  selectedChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
}

const ChapterSidebar: React.FC<ChapterSidebarProps> = ({
  projectId,
  isVisible,
  onToggle,
  selectedChapterId,
  onSelectChapter,
}) => {
  const store = useUnifiedObjectStore();
  const { getChapterContent, getVersions, setActiveVersion } = useNovelStore();
  const [showVersions, setShowVersions] = useState(false);
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

  // Get versions for selected chapter
  const selectedChapterVersions = selectedChapterId ? getVersions(projectId, selectedChapterId) : [];
  const selectedChapterContent = selectedChapterId ? getChapterContent(projectId, selectedChapterId) : null;

  // Find selected chapter for display
  const selectedChapter = selectedChapterId ? (store.objects[selectedChapterId] as ChapterObject) : null;

  if (acts.length === 0) {
    return (
      <div className={`chapter-sidebar ${isVisible ? 'visible' : 'hidden'}`}>
        <div className="chapter-sidebar-header">
          <h3>Chapters</h3>
          <button
            className="sidebar-close-btn"
            onClick={onToggle}
            title="Close chapter list"
          >
            Close
          </button>
        </div>
        <div className="chapter-sidebar-content">
          <div className="no-chapters-message">
            <p>No chapters available.</p>
            <p>Create acts and chapters in the Workspace first.</p>
          </div>
        </div>
      </div>
    );
  }

  const handleVersionSelect = async (versionId: string) => {
    if (selectedChapterId) {
      try {
        await setActiveVersion(projectId, selectedChapterId, versionId);
      } catch (error) {
        console.error('Failed to set active version:', error);
      }
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className={`chapter-sidebar ${isVisible ? 'visible' : 'hidden'}`}>
      <div className="chapter-sidebar-header">
        <div className="sidebar-nav">
          <button
            className={`nav-tab ${!showVersions ? 'active' : ''}`}
            onClick={() => setShowVersions(false)}
          >
            Chapters
          </button>
          {selectedChapterId && (
            <button
              className={`nav-tab ${showVersions ? 'active' : ''}`}
              onClick={() => setShowVersions(true)}
            >
              Versions
            </button>
          )}
        </div>
        <button
          className="sidebar-close-btn"
          onClick={onToggle}
          title="Close sidebar"
        >
          Close
        </button>
      </div>

      <div className="chapter-sidebar-content">
        {!showVersions ? (
          // Chapters View
          acts.map((act, actIndex) => {
            const actChapters = getChaptersForAct(act.id);

            return (
              <div key={act.id} className="act-section">
                <div className="act-header">
                  <div className="act-info">
                    <h4 className="act-title">
                      Act {actIndex + 1}: {act.data.name || 'Untitled Act'}
                    </h4>
                    {act.data.description && (
                      <p className="act-description">{act.data.description}</p>
                    )}
                  </div>
                </div>

                <div className="chapters-list">
                  {actChapters.length > 0 ? (
                    actChapters.map((chapter, chapterIndex) => {
                      const chapterContent = getChapterContent(projectId, chapter.id);
                      const wordCount = chapterContent?.wordCount || 0;
                      const isSelected = selectedChapterId === chapter.id;

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
                                {chapter.data.name || 'Untitled Chapter'}
                              </span>
                            </div>
                            <div className="chapter-meta">
                              <span className="word-count">
                                {wordCount} words
                              </span>
                            </div>
                          </div>
                          {chapter.data.description && (
                            <div className="chapter-description">
                              {chapter.data.description}
                            </div>
                          )}
                          <div className="chapter-status">
                            {chapterContent ? (
                              <span className="status-indicator has-content">●</span>
                            ) : (
                              <span className="status-indicator no-content">○</span>
                            )}
                            <span className="status-text">
                              {chapterContent ? 'Has content' : 'Empty'}
                            </span>
                          </div>
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
          })
        ) : (
          // Versions View
          <div className="versions-section">
            {selectedChapterContent && selectedChapter && (
              <div className="selected-chapter-info">
                <h4 className="chapter-title">
                  {selectedChapter.data.name || 'Untitled Chapter'}
                </h4>
                <p className="version-count">
                  {selectedChapterVersions.length} version{selectedChapterVersions.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <div className="versions-list">
              {selectedChapterVersions
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .map((version, index) => {
                  // Calculate total word count from all languages
                  const totalWordCount = Object.values(version.data).reduce((sum, langData) => sum + (langData.wordCount || 0), 0);

                  return (
                    <div
                      key={version.id}
                      className={`version-item ${version.is_active ? 'active' : ''}`}
                      onClick={() => handleVersionSelect(version.id)}
                    >
                      <div className="version-header">
                        <div className="version-info">
                          <div className="version-label">
                            {index === 0 ? 'Latest' : `Version ${selectedChapterVersions.length - index}`}
                            {version.is_active && ' (Current)'}
                          </div>
                          <div className="version-date">
                            {formatDate(new Date(version.timestamp))}
                          </div>
                        </div>
                        <div className="version-meta">
                          <span className="word-count">
                            {totalWordCount} words
                          </span>
                        </div>
                      </div>
                      <div className="version-description">
                        {version.userRequest}
                      </div>
                    </div>
                  );
                })}

              {selectedChapterVersions.length === 0 && (
                <div className="no-versions">
                  <p>No versions available</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChapterSidebar;
