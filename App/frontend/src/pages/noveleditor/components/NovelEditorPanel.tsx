import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNovelStore } from '../../../store/novelStore';
import type { Chapter } from '../../../types/storyObject';
import type { StoryObjects } from '../../../types/storyObject';
import type { NovelEditorUIState, NovelEditorUIActions } from '../hooks/useNovelEditorState';
import ChapterSidebar from './ChapterSidebar';
import NovelChapterAIEditModal from '../../../components/NovelChapterAIEditModal';

interface NovelEditorPanelProps {
  projectId: string;
  selectedChapter: Chapter | null;
  selectedChapterId: string | null;
  storyObjects: StoryObjects;
  uiState: NovelEditorUIState;
  uiActions: NovelEditorUIActions;
  onToggleSidebar: () => void;
  onSelectChapter: (chapterId: string) => void;
}

const NovelEditorPanel: React.FC<NovelEditorPanelProps> = ({
  projectId,
  selectedChapter,
  selectedChapterId,
  storyObjects,
  uiState,
  uiActions,
  onToggleSidebar,
  onSelectChapter,
}) => {
  const {
    getChapterContent,
    updateChapterContent,
    createChapterContent,
    getWordCount
  } = useNovelStore();

  // Get the current chapter content from store for reactivity
  const storeChapterContent = useNovelStore((state) =>
    selectedChapterId ? state.chapterContentsByProject[projectId]?.[selectedChapterId] : null
  );

  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isUserEditingRef = useRef<boolean>(false);

  // Load chapter content when chapter changes
  useEffect(() => {
    if (!selectedChapter) {
      setContent('');
      setLastSavedContent('');
      return;
    }

    const chapterContent = getChapterContent(projectId, selectedChapter.id);
    if (chapterContent) {
      setContent(chapterContent.content);
      setLastSavedContent(chapterContent.content);
    } else {
      // Create new chapter content if doesn't exist
      const newContent = createChapterContent(projectId, selectedChapter.id, '');
      setContent(newContent.content);
      setLastSavedContent(newContent.content);
    }
  }, [selectedChapter, projectId, getChapterContent, createChapterContent]);

  // Listen for external updates to chapter content (e.g., from AI function calls)
  useEffect(() => {
    if (!storeChapterContent || !selectedChapter) return;

    // Check if store content is different from current editor content and user is not editing
    const isDifferent = storeChapterContent.content !== content;
    const isNotUserEdit = !isUserEditingRef.current;
    const isNotSelfUpdate = storeChapterContent.content !== lastSavedContent; // Prevent updates from own saves

    if (isDifferent && isNotUserEdit && isNotSelfUpdate) {
      console.log('AI updated chapter content, updating editor:', {
        newContent: storeChapterContent.content.substring(0, 100) + '...',
        updatedAt: storeChapterContent.updatedAt
      });

      setContent(storeChapterContent.content);
      setLastSavedContent(storeChapterContent.content);
    }
  }, [storeChapterContent?.content, storeChapterContent?.updatedAt, selectedChapter?.id]);

  // Auto-save functionality
  const saveContent = useCallback(async () => {
    if (!selectedChapter || content === lastSavedContent) return;

    setIsSaving(true);
    try {
      updateChapterContent(projectId, selectedChapter.id, content, 'Auto-save');
      setLastSavedContent(content);
    } catch (error) {
      console.error('Error saving chapter content:', error);
    } finally {
      setIsSaving(false);
    }
  }, [selectedChapter, content, lastSavedContent, projectId, updateChapterContent]);

  // Debounced auto-save
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (content !== lastSavedContent) {
      saveTimeoutRef.current = setTimeout(saveContent, 2000); // Save after 2 seconds of inactivity
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [content, lastSavedContent, saveContent]);

  // Manual save function
  const handleManualSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveContent();
  }, [saveContent]);

  // AI Edit handler
  const handleAIEditResult = useCallback((newContent: string) => {
    if (!selectedChapter) return;

    // Save current content first if there are unsaved changes
    if (content !== lastSavedContent) {
      updateChapterContent(projectId, selectedChapter.id, content, 'Pre-AI Edit save');
    }

    // Update with AI-edited content
    updateChapterContent(projectId, selectedChapter.id, newContent, 'AI Edit');
    setContent(newContent);
    setLastSavedContent(newContent);
  }, [selectedChapter, content, lastSavedContent, projectId, updateChapterContent]);

  // Content change handler
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    isUserEditingRef.current = true;
    setContent(e.target.value);

    // Reset user editing flag after a delay
    setTimeout(() => {
      isUserEditingRef.current = false;
    }, 1000);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleManualSave]);

  const wordCount = getWordCount(content);
  const hasUnsavedChanges = content !== lastSavedContent;

  if (!selectedChapter) {
    return (
      <div className="novel-editor-panel">
        <div className="editor-placeholder">
          <div className="placeholder-content">
            <div className="placeholder-icon">📝</div>
            <h2>Welcome to Novel Editor</h2>
            <p>Select a chapter from the sidebar to start writing.</p>
            <p>Create acts and chapters in the Workspace first if you haven't already.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="novel-editor-panel">
      {/* Chapter Sidebar */}
      <ChapterSidebar
        projectId={projectId}
        isVisible={uiState.isChapterSidebarVisible}
        onToggle={onToggleSidebar}
        selectedChapterId={selectedChapterId}
        onSelectChapter={onSelectChapter}
      />

      {/* Chapter Sidebar Overlay */}
      {uiState.isChapterSidebarVisible && (
        <div className="chapter-sidebar-overlay" onClick={onToggleSidebar} />
      )}

      <div className="editor-main">
        <div className="editor-header">
          <div className="editor-info">
            <h2 className="editor-chapter-title">
              {selectedChapter.name || 'Untitled Chapter'}
            </h2>
            <div className="chapter-info">
              {selectedChapter && (
                <span className="chapter-subtitle">
                  {/* Find act name for context */}
                  {storyObjects.outline?.acts.find(act =>
                    act.chapters.some(ch => ch.id === selectedChapter.id)
                  )?.name} - Chapter
                </span>
              )}
            </div>
            {selectedChapter.description && (
              <p className="editor-chapter-description">
                {selectedChapter.description}
              </p>
            )}
          </div>
          <div className="editor-stats">
            <div className="stat-item">
              <span className="stat-label">Words:</span>
              <span className="stat-value">{wordCount.toLocaleString()}</span>
            </div>
            <div className="save-status">
              {isSaving ? (
                <span className="saving-indicator">💾 Saving...</span>
              ) : hasUnsavedChanges ? (
                <span className="unsaved-indicator">● Unsaved changes</span>
              ) : (
                <span className="saved-indicator">✓ Saved</span>
              )}
            </div>
          </div>
        </div>

        <div className="editor-toolbar">
          <div className="toolbar-info">
            <span className="keyboard-shortcut">Ctrl+S to save</span>
          </div>
          <button
            className="toolbar-btn settings-btn"
            onClick={() => uiActions.setIsSettingsOpen(true)}
            title="Settings"
          >
            ⚙️
          </button>
          <div className="toolbar-separator" />
          <button
            className="toolbar-btn ai-edit-btn"
            onClick={() => uiActions.setIsAIEditModalOpen(true)}
            disabled={!selectedChapter}
            title="AI Edit"
          >
            🤖 AI Edit
          </button>
          <button
            className="toolbar-btn save-btn"
            onClick={handleManualSave}
            disabled={!hasUnsavedChanges || isSaving}
            title="Save now (Ctrl+S)"
          >
            💾 Save
          </button>
          <div className="toolbar-separator" />
          <button
            className="toolbar-btn sidebar-toggle-btn"
            onClick={onToggleSidebar}
            title="Toggle chapter list"
          >
            📂
          </button>
        </div>

        <div className="editor-content">
          <textarea
            ref={textareaRef}
            className="novel-textarea"
            value={content}
            onChange={handleContentChange}
            placeholder={`Start writing ${selectedChapter.name || 'your chapter'}...`}
            disabled={isSaving}
            spellCheck
          />
        </div>
      </div>

      {/* AI Edit Modal */}
      {selectedChapter && (
        <NovelChapterAIEditModal
          isOpen={uiState.isAIEditModalOpen}
          onClose={() => uiActions.setIsAIEditModalOpen(false)}
          projectId={projectId}
          chapterId={selectedChapter.id}
          chapterName={selectedChapter.name || 'Untitled Chapter'}
          onResult={handleAIEditResult}
        />
      )}
    </div>
  );
};

export default NovelEditorPanel;