import React, { useState } from 'react';
import { useStoryObjectStore } from '../../../store/storyObjectStore';
import { useNovelStore } from '../../../store/novelStore';

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
  const { getStoryObjects } = useStoryObjectStore();
  const { getChapterContent, getVersions, setActiveVersion } = useNovelStore();
  const [showVersions, setShowVersions] = useState(false);

  const storyObjects = getStoryObjects(projectId);
  const outline = storyObjects.outline;

  // Get versions for selected chapter
  const selectedChapterVersions = selectedChapterId ? getVersions(projectId, selectedChapterId) : [];
  const selectedChapterContent = selectedChapterId ? getChapterContent(projectId, selectedChapterId) : null;

  if (!outline || !outline.acts || outline.acts.length === 0) {
    return (
      <div className={`chapter-sidebar ${isVisible ? 'visible' : 'hidden'}`}>
        <div className="chapter-sidebar-header">
          <h3>📖 Chapters</h3>
          <button
            className="sidebar-close-btn"
            onClick={onToggle}
            title="Close chapter list"
          >
            ✕
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

  const handleVersionSelect = (versionId: string) => {
    if (selectedChapterId) {
      setActiveVersion(projectId, selectedChapterId, versionId);
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
            📖 Chapters
          </button>
          {selectedChapterId && (
            <button
              className={`nav-tab ${showVersions ? 'active' : ''}`}
              onClick={() => setShowVersions(true)}
            >
              📚 Versions
            </button>
          )}
        </div>
        <button
          className="sidebar-close-btn"
          onClick={onToggle}
          title="Close sidebar"
        >
          ✕
        </button>
      </div>

      <div className="chapter-sidebar-content">
        {!showVersions ? (
          // Chapters View
          outline.acts.map((act, actIndex) => (
          <div key={act.id} className="act-section">
            <div className="act-header">
              <div className="act-info">
                <h4 className="act-title">
                  Act {actIndex + 1}: {act.name || 'Untitled Act'}
                </h4>
                {act.description && (
                  <p className="act-description">{act.description}</p>
                )}
              </div>
            </div>

            <div className="chapters-list">
              {act.chapters && act.chapters.length > 0 ? (
                act.chapters.map((chapter, chapterIndex) => {
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
                            {chapter.name || 'Untitled Chapter'}
                          </span>
                        </div>
                        <div className="chapter-meta">
                          <span className="word-count">
                            {wordCount} words
                          </span>
                        </div>
                      </div>
                      {chapter.description && (
                        <div className="chapter-description">
                          {chapter.description}
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
        ))
        ) : (
          // Versions View
          <div className="versions-section">
            {selectedChapterContent && (
              <div className="selected-chapter-info">
                <h4 className="chapter-title">
                  {storyObjects.outline?.acts
                    .find(act => act.chapters.some(ch => ch.id === selectedChapterId))
                    ?.chapters.find(ch => ch.id === selectedChapterId)?.name || 'Untitled Chapter'}
                </h4>
                <p className="version-count">
                  {selectedChapterVersions.length} version{selectedChapterVersions.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <div className="versions-list">
              {selectedChapterVersions
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .map((version, index) => (
                  <div
                    key={version.versionId}
                    className={`version-item ${version.isActive ? 'active' : ''}`}
                    onClick={() => handleVersionSelect(version.versionId)}
                  >
                    <div className="version-header">
                      <div className="version-info">
                        <div className="version-label">
                          {index === 0 ? '🟢 Latest' : `Version ${selectedChapterVersions.length - index}`}
                          {version.isActive && ' (Current)'}
                        </div>
                        <div className="version-date">
                          {formatDate(new Date(version.timestamp))}
                        </div>
                      </div>
                      <div className="version-meta">
                        <span className="word-count">
                          {version.wordCount} words
                        </span>
                      </div>
                    </div>
                    <div className="version-description">
                      {version.userRequest}
                    </div>
                  </div>
                ))}

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