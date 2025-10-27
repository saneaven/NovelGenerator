import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNovelStore } from '../../../store/novelStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { TranslationService } from '../../../services/translationService';
import { streamChat } from '../../../llm_request/llmService';
import type { Chapter } from '../../../types/storyObject';
import type { StoryObjects } from '../../../types/storyObject';
import type { NovelEditorUIState, NovelEditorUIActions } from '../hooks/useNovelEditorState';
import ChapterSidebar from './ChapterSidebar';
import NovelChapterAIEditModal from '../../../components/NovelChapterAIEditModal';

const COMMON_LANGUAGES = [
  'English',
  'Korean',
  'Japanese',
  'Chinese',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Hindi',
];

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
  const getChapterContent = useNovelStore(state => state.getChapterContent);
  const createChapterContent = useNovelStore(state => state.createChapterContent);
  const updateChapterContentForLanguage = useNovelStore(state => state.updateChapterContentForLanguage);
  const addTranslatedContent = useNovelStore(state => state.addTranslatedContent);
  const getWordCount = useNovelStore(state => state.getWordCount);

  const chapterContentSelector = useCallback(
    (state: any) =>
      selectedChapterId ? state.chapterContentsByProject[projectId]?.[selectedChapterId] ?? null : null,
    [projectId, selectedChapterId]
  );
  const storeChapterContent = useNovelStore(chapterContentSelector);

  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

  const primaryLanguage = settings.primaryLanguage;
  const secondaryLanguage = settings.secondaryLanguage;
  const aiModel = settings.aiModel;

  const [activeLanguage, setActiveLanguage] = useState<string>(primaryLanguage);
  const [content, setContent] = useState('');
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [customLanguage, setCustomLanguage] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isUserEditingRef = useRef(false);

  const activeVersion = useMemo(() => {
    console.log('[NovelEditor] Computing activeVersion:', {
      hasStoreContent: !!storeChapterContent,
      versionsCount: storeChapterContent?.versions?.length ?? 0,
      versions: storeChapterContent?.versions
    });

    if (!storeChapterContent) return null;
    const active = storeChapterContent.versions.find(version => version.is_active) ?? null;

    console.log('[NovelEditor] Active version found:', {
      found: !!active,
      versionId: active?.id,
      languages: active ? Object.keys(active.data) : []
    });

    return active;
  }, [storeChapterContent]);

  const activeLanguageEntry = useMemo(() => {
    if (!activeVersion) return null;
    return activeVersion.data[activeLanguage] ?? null;
  }, [activeVersion, activeLanguage]);

  const availableLanguages = useMemo(() => {
    return activeVersion ? TranslationService.getAvailableLanguages(activeVersion.data) : [];
  }, [activeVersion]);

  const suggestedLanguages = useMemo(() => {
    const suggestions = new Set<string>();

    if (secondaryLanguage) {
      suggestions.add(secondaryLanguage);
    }

    for (const language of COMMON_LANGUAGES) {
      suggestions.add(language);
    }

    for (const existing of availableLanguages) {
      suggestions.delete(existing);
    }

    suggestions.delete(activeLanguage);
    suggestions.delete(primaryLanguage);

    return Array.from(suggestions);
  }, [availableLanguages, activeLanguage, primaryLanguage, secondaryLanguage]);

  const wordCount = useMemo(() => getWordCount(content), [content, getWordCount]);
  const hasUnsavedChanges = content !== lastSavedContent;

  useEffect(() => {
    setCustomLanguage('');
    setTranslationError(null);
    isUserEditingRef.current = false;
  }, [selectedChapterId]);

  useEffect(() => {
    if (!selectedChapterId) {
      setActiveLanguage(primaryLanguage);
      return;
    }

    if (availableLanguages.includes(activeLanguage)) {
      return;
    }

    if (availableLanguages.includes(primaryLanguage)) {
      setActiveLanguage(primaryLanguage);
      return;
    }

    if (secondaryLanguage && availableLanguages.includes(secondaryLanguage)) {
      setActiveLanguage(secondaryLanguage);
      return;
    }

    if (availableLanguages.length > 0) {
      setActiveLanguage(availableLanguages[0]);
    } else {
      setActiveLanguage(primaryLanguage);
    }
  }, [activeLanguage, availableLanguages, primaryLanguage, secondaryLanguage, selectedChapterId]);

  useEffect(() => {
    console.log('[NovelEditor] Content loading effect triggered:', {
      hasSelectedChapter: !!selectedChapter,
      hasActiveVersion: !!activeVersion,
      activeLanguage,
      isUserEditing: isUserEditingRef.current
    });

    if (!selectedChapter) {
      console.log('[NovelEditor] No selected chapter, clearing content');
      setContent('');
      setLastSavedContent('');
      uiActions.setEditorContent('');
      return;
    }

    if (!activeVersion) {
      console.log('[NovelEditor] No active version');
      if (!isUserEditingRef.current) {
        console.log('[NovelEditor] User not editing, clearing content');
        setContent('');
        setLastSavedContent('');
        uiActions.setEditorContent('');
      }
      return;
    }

    const entry = activeVersion.data[activeLanguage];
    console.log('[NovelEditor] Language entry:', {
      hasEntry: !!entry,
      language: activeLanguage,
      contentLength: entry?.content?.length ?? 0
    });

    // Only load if not currently editing
    if (entry && !isUserEditingRef.current) {
      console.log('[NovelEditor] Loading content from store:', entry.content.substring(0, 50));
      setContent(entry.content);
      setLastSavedContent(entry.content);
      uiActions.setEditorContent(entry.content);
    }

    if (!entry && !isUserEditingRef.current) {
      console.log('[NovelEditor] No entry for language, clearing content');
      setContent('');
      setLastSavedContent('');
      uiActions.setEditorContent('');
    }
  }, [activeLanguage, activeVersion, selectedChapter, uiActions]);

  const handleContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setContent(value);
    uiActions.setEditorContent(value);
    isUserEditingRef.current = true;
    setTranslationError(null);
  }, [uiActions]);

  const saveContent = useCallback(async (reason: string, createNewVersion = false) => {
    console.log('[NovelEditor] saveContent called:', { reason, createNewVersion, selectedChapter: selectedChapter?.id, hasUnsavedChanges, contentLength: content.length });

    if (!selectedChapter) {
      console.log('[NovelEditor] No selected chapter, aborting save');
      return;
    }

    if (!hasUnsavedChanges) {
      console.log('[NovelEditor] No unsaved changes, aborting save');
      return;
    }

    uiActions.setIsSaving(true);
    try {
      console.log('[NovelEditor] Calling updateChapterContentForLanguage:', {
        projectId,
        chapterId: selectedChapter.id,
        language: activeLanguage,
        contentPreview: content.substring(0, 50) + '...',
        createNewVersion
      });

      await updateChapterContentForLanguage(projectId, selectedChapter.id, content, activeLanguage, reason, createNewVersion);

      console.log('[NovelEditor] Save successful, updating lastSavedContent');
      setLastSavedContent(content);
      isUserEditingRef.current = false;
    } catch (error) {
      console.error('[NovelEditor] Error saving chapter content:', error);
      const message = error instanceof Error ? error.message : 'Unknown error during save.';
      showError('Save Failed', message);
    } finally {
      uiActions.setIsSaving(false);
    }
  }, [activeLanguage, content, hasUnsavedChanges, projectId, selectedChapter, showError, uiActions, updateChapterContentForLanguage]);

  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (!hasUnsavedChanges) {
      return;
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      void saveContent('Auto-save', false);  // Auto-save updates existing version
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [hasUnsavedChanges, saveContent]);

  const handleManualSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    void saveContent('Manual save', true);  // Manual save creates new version
  }, [saveContent]);

  const translateChapter = useCallback(async (targetLanguage: string) => {
    if (!selectedChapter || !activeVersion) return;

    const normalizedTarget = targetLanguage.trim();
    if (!normalizedTarget) return;

    if (availableLanguages.includes(normalizedTarget)) {
      setActiveLanguage(normalizedTarget);
      return;
    }

    const fallback = TranslationService.getBestLanguageData(activeVersion.data, activeLanguage, primaryLanguage);
    if (!fallback) {
      showError('Translation Failed', 'No source content is available to translate.');
      return;
    }

    const translationKey = `${selectedChapter.id}:${normalizedTarget}`;

    try {
      setIsTranslating(true);
      setTranslationError(null);
      TranslationService.setTranslationStatus(translationKey, { objectId: translationKey, isTranslating: true });

      const translationRequest = await TranslationService.prepareTranslationRequest({
        sourceLanguage: fallback.language,
        targetLanguage: normalizedTarget,
        data: {
          content: fallback.data.content,
          wordCount: fallback.data.wordCount ?? getWordCount(fallback.data.content),
        },
        dataType: 'chapterContent',
      });

      const provider = settings.activeProvider;
      const providerConfig = settings.providers[provider];

      let response = '';
      for await (const chunk of streamChat(
        translationRequest.messages,
        provider,
        providerConfig,
        {
          model: aiModel,
          temperature: 0.2,
        }
      )) {
        if (typeof chunk === 'string') {
          response += chunk;
        } else if (chunk.content) {
          response += chunk.content;
        }
      }

      const parsed = TranslationService.parseTranslationResponse(response);
      const validation = TranslationService.validateTranslationResult(parsed, 'chapterContent');
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const translatedContent = parsed.content;
      addTranslatedContent(projectId, selectedChapter.id, activeVersion.id, translatedContent, normalizedTarget);

      setActiveLanguage(normalizedTarget);
      setContent(translatedContent);
      setLastSavedContent(translatedContent);
      uiActions.setEditorContent(translatedContent);
      isUserEditingRef.current = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown translation error.';
      setTranslationError(message);
      showError('Translation Failed', message);
    } finally {
      setIsTranslating(false);
      TranslationService.clearTranslationStatus(translationKey);
    }
  }, [activeLanguage, activeVersion, addTranslatedContent, aiModel, availableLanguages, getWordCount, primaryLanguage, projectId, selectedChapter, showError, uiActions]);

  const handleLanguageChange = useCallback((language: string) => {
    const target = language.trim();
    if (!target) return;

    setIsLanguageMenuOpen(false);
    setTranslationError(null);
    void translateChapter(target);
  }, [translateChapter]);

  const handleSecondaryToggle = useCallback(() => {
    if (!secondaryLanguage) return;

    const target = activeLanguage === secondaryLanguage ? primaryLanguage : secondaryLanguage;
    void handleLanguageChange(target);
  }, [activeLanguage, handleLanguageChange, primaryLanguage, secondaryLanguage]);

  const handleCustomLanguageSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customLanguage.trim()) return;

    void handleLanguageChange(customLanguage);
    setCustomLanguage('');
  }, [customLanguage, handleLanguageChange]);

  const handleAIEditResult = useCallback((newContent: string) => {
    if (!selectedChapter) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    try {
      updateChapterContentForLanguage(projectId, selectedChapter.id, newContent, activeLanguage, 'AI Edit', true);  // AI edits create new version
      setContent(newContent);
      setLastSavedContent(newContent);
      uiActions.setEditorContent(newContent);
      isUserEditingRef.current = false;
    } catch (error) {
      console.error('Error applying AI edit:', error);
      const message = error instanceof Error ? error.message : 'Unknown error while applying AI edit.';
      showError('AI Edit Failed', message);
    }
  }, [activeLanguage, projectId, selectedChapter, showError, uiActions, updateChapterContentForLanguage]);

  const renderLanguageMenu = () => {
    if (!isLanguageMenuOpen) return null;

    return (
      <div
        className="language-menu"
        style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 8px)',
          zIndex: 10,
          minWidth: '220px',
          background: '#ffffff',
          border: '1px solid #d0d0d0',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
          padding: '12px',
        }}
      >
        <div className="language-menu-section">
          <div className="language-menu-title">Available languages</div>
          {availableLanguages.length === 0 && <div className="language-menu-item">None yet</div>}
          {availableLanguages.map(language => (
            <button
              key={language}
              className="language-menu-item"
              onClick={() => handleLanguageChange(language)}
              disabled={isTranslating || language === activeLanguage}
            >
              {language}{language === activeLanguage ? ' (current)' : ''}
            </button>
          ))}
        </div>

        <div className="language-menu-section" style={{ marginTop: '12px' }}>
          <div className="language-menu-title">Translate to</div>
          {suggestedLanguages.slice(0, 6).map(language => (
            <button
              key={language}
              className="language-menu-item"
              onClick={() => handleLanguageChange(language)}
              disabled={isTranslating}
            >
              {`Translate to ${language}`}
            </button>
          ))}
          <form className="custom-language-form" onSubmit={handleCustomLanguageSubmit} style={{ marginTop: '8px' }}>
            <input
              type="text"
              value={customLanguage}
              onChange={(event) => setCustomLanguage(event.target.value)}
              placeholder="Custom language"
              className="language-input"
            />
            <button type="submit" className="language-submit" disabled={isTranslating}>
              Translate
            </button>
          </form>
        </div>
      </div>
    );
  };


  const activeActName = useMemo(() => {
    if (!storyObjects.outline || !selectedChapter) return null;
    return storyObjects.outline.acts.find(act => act.chapters.some(ch => ch.id === selectedChapter.id))?.name ?? null;
  }, [storyObjects.outline, selectedChapter]);

  if (!selectedChapter || !selectedChapterId) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>Select a chapter to begin</h2>
          <p>
            Choose a chapter from the sidebar to view and edit its multilingual content. You can also
            use the chat panel to ask the assistant to draft or revise chapters for you.
          </p>
          <ChapterSidebar
            projectId={projectId}
            isVisible={true}
            onToggle={onToggleSidebar}
            selectedChapterId={selectedChapterId}
            onSelectChapter={onSelectChapter}
          />
        </div>
      </div>
    );
  }


  return (
    <div className="novel-editor-panel">
      <ChapterSidebar
        projectId={projectId}
        isVisible={uiState.isChapterSidebarVisible}
        onToggle={onToggleSidebar}
        selectedChapterId={selectedChapterId}
        onSelectChapter={onSelectChapter}
      />

      {uiState.isChapterSidebarVisible && (
        <div className="chapter-sidebar-overlay" onClick={onToggleSidebar} />
      )}

      <div className="editor-main">
        <div className="editor-header">
          <div className="editor-info">
            <h2 className="editor-chapter-title">{selectedChapter.name || 'Untitled Chapter'}</h2>
            <div className="chapter-info">
              {activeActName && (
                <span className="chapter-subtitle">{activeActName} - Chapter</span>
              )}
            </div>
            {selectedChapter.description && (
              <p className="editor-chapter-description">{selectedChapter.description}</p>
            )}
          </div>
          <div className="editor-stats">
            <div className="stat-item">
              <span className="stat-label">Language:</span>
              <span className="stat-value">{activeLanguage}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Words:</span>
              <span className="stat-value">{wordCount.toLocaleString()}</span>
            </div>
            <div className="save-status">
              {uiState.isSaving ? 'Saving...' : hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}
            </div>
          </div>
        </div>

        <div className="editor-toolbar">
          <div className="toolbar-info">
            <span className="keyboard-shortcut">Press Ctrl+S to save</span>
          </div>
          <div className="toolbar-actions">
            {secondaryLanguage && (
              <button
                className="toolbar-btn translate-toggle-btn"
                onClick={handleSecondaryToggle}
                disabled={isTranslating}
              >
                {isTranslating
                  ? 'Translating...'
                  : activeLanguage === secondaryLanguage
                    ? `View ${primaryLanguage}`
                    : `View ${secondaryLanguage}`}
              </button>
            )}
            <div className="language-menu-wrapper" style={{ position: 'relative' }}>
              <button
                className="toolbar-btn language-menu-btn"
                onClick={() => setIsLanguageMenuOpen(prev => !prev)}
                disabled={isTranslating}
              >
                Other languages
              </button>
              {renderLanguageMenu()}
            </div>
            <div className="toolbar-separator" />
            <button
              className="toolbar-btn ai-edit-btn"
              onClick={() => uiActions.setIsAIEditModalOpen(true)}
              disabled={!selectedChapter}
              title="Ask the assistant to edit this chapter"
            >
              AI Edit
            </button>
            <button
              className="toolbar-btn save-btn"
              onClick={handleManualSave}
              disabled={!hasUnsavedChanges}
              title="Save now"
            >
              Save
            </button>
            <div className="toolbar-separator" />
            <button
              className="toolbar-btn sidebar-toggle-btn"
              onClick={onToggleSidebar}
              title="Toggle chapter list"
            >
              ☰
            </button>
          </div>
        </div>

        {translationError && (
          <div className="translation-error" role="alert">
            {translationError}
          </div>
        )}

        {!activeLanguageEntry && availableLanguages.length > 0 && (
          <div className="missing-language-notice">
            <p>No {activeLanguage} translation yet. Use the buttons above to translate an existing version or start writing in this language.</p>
          </div>
        )}

        <div className="editor-content">
          <textarea
            ref={textareaRef}
            className="novel-textarea"
            value={content}
            onChange={handleContentChange}
            placeholder={`Write this chapter in ${activeLanguage}...`}
            spellCheck
          />
        </div>
      </div>

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

