import React, { useState, useEffect } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { ActObject, ChapterObject, ManuscriptObject, VersionHistoryEntry } from '../../../types/unifiedObject';

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
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const [showVersions, setShowVersions] = useState(false);

  // Helper to get data for language with fallback
  const getActData = (act: ActObject) => {
    const data = act.data[mainLanguage];
    if (data) return data;
    const available = Object.keys(act.data);
    return available.length > 0 ? act.data[available[0]] : { name: '', description: '' };
  };

  const getChapterData = (chapter: ChapterObject) => {
    const data = chapter.data[mainLanguage];
    if (data) return data;
    const available = Object.keys(chapter.data);
    return available.length > 0 ? chapter.data[available[0]] : { name: '', description: '' };
  };

  const getManuscriptData = (manuscript: ManuscriptObject) => {
    const data = manuscript.data[mainLanguage];
    if (data) return data;
    const available = Object.keys(manuscript.data);
    return available.length > 0 ? manuscript.data[available[0]] : { content: '', wordCount: 0 };
  };
  const [actIds, setActIds] = useState<string[]>([]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [selectedChapterVersions, setSelectedChapterVersions] = useState<VersionHistoryEntry[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

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

  // Load versions when selected chapter changes
  useEffect(() => {
    const loadVersions = async () => {
      if (!selectedChapterId) {
        setSelectedChapterVersions([]);
        setActiveVersionId(null);
        return;
      }

      const manuscriptObj = store.getManuscriptByChapterId(selectedChapterId);
      if (!manuscriptObj) {
        setSelectedChapterVersions([]);
        setActiveVersionId(null);
        return;
      }

      try {
        const versions = await store.getVersions('manuscript', manuscriptObj.id);
        setSelectedChapterVersions(versions);
        // Find active version (the one with highest number or marked as current)
        // For now, assume first version (by number desc) is active if not specified
        if (versions.length > 0) {
          const sortedVersions = [...versions].sort((a, b) => b.number - a.number);
          setActiveVersionId(sortedVersions[0].id);
        }
      } catch (error) {
        console.error('Failed to load versions:', error);
        setSelectedChapterVersions([]);
      }
    };

    loadVersions();
  }, [selectedChapterId, store.objects]);

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

  // Get selected manuscript
  const selectedManuscript = selectedChapterId ? getManuscript(selectedChapterId) : null;

  // Find selected chapter for display
  const selectedChapter = selectedChapterId ? (store.objects[selectedChapterId] as ChapterObject) : null;

  if (acts.length === 0) {
    return (
      <>
        {isVisible && (
          <div className="chapter-sidebar-backdrop" onClick={onToggle} />
        )}
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
      </>
    );
  }

  const handleVersionSelect = async (versionId: string) => {
    if (!selectedChapterId) return;

    const manuscriptObj = store.getManuscriptByChapterId(selectedChapterId);
    if (!manuscriptObj) return;

    try {
      await store.restoreVersion('manuscript', manuscriptObj.id, versionId);
      setActiveVersionId(versionId);
    } catch (error) {
      console.error('Failed to set active version:', error);
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
    <>
      {isVisible && (
        <div className="chapter-sidebar-backdrop" onClick={onToggle} />
      )}
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
          })
        ) : (
          // Versions View
          <div className="versions-section">
            {selectedManuscript && selectedChapter && (
              <div className="selected-chapter-info">
                <h4 className="chapter-title">
                  {getChapterData(selectedChapter).name || 'Untitled Chapter'}
                </h4>
                <p className="version-count">
                  {selectedChapterVersions.length} version{selectedChapterVersions.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <div className="versions-list">
              {[...selectedChapterVersions]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((version, index) => {
                  // Calculate total word count from all languages
                  const totalWordCount = Object.values(version.data).reduce((sum, langData: any) => sum + (langData.wordCount || 0), 0);
                  const isActive = version.id === activeVersionId;

                  return (
                    <div
                      key={version.id}
                      className={`version-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleVersionSelect(version.id)}
                    >
                      <div className="version-header">
                        <div className="version-info">
                          <div className="version-label">
                            {index === 0 ? 'Latest' : `Version ${selectedChapterVersions.length - index}`}
                            {isActive && ' (Current)'}
                          </div>
                          <div className="version-date">
                            {formatDate(new Date(version.created_at))}
                          </div>
                        </div>
                        <div className="version-meta">
                          <span className="word-count">
                            {totalWordCount} words
                          </span>
                        </div>
                      </div>
                      <div className="version-languages">
                        {Object.keys(version.data).map(lang => (
                          <span key={lang} className="lang-badge">{lang}</span>
                        ))}
                      </div>
                      <div className="version-description">
                        {version.user_request || 'No description'}
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
    </>
  );
};

export default ChapterSidebar;
