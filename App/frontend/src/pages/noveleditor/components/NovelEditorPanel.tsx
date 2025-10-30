import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNovelStore } from '../../../store/novelStore';
import { useStoryObjectStore } from '../../../store/storyObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { TranslationService } from '../../../services/translationService';
import type { Chapter } from '../../../types/storyObject';
import type { StoryObjects } from '../../../types/storyObject';
import type { NovelEditorUIState, NovelEditorUIActions } from '../hooks/useNovelEditorState';
import type { FunctionCallMetadata, ChatMessage } from '../../../llm_request/types';
import { ChatManager, type ChatManagerConfig, type ChatManagerCallbacks } from '../../../chat/processors/ChatManager';
import { ChatPipeline } from '../../../chat/ChatPipeline';
import { getTranslationFunctionSchema } from '../../../chat/types/translationFunctionSchemas';
import { applyTranslationFunctionCalls, type TranslationContext } from '../../../chat/utils/translationFunctionApplicator';
import ChapterSidebar from './ChapterSidebar';
import NovelChapterAIEditModal from '../../../components/NovelChapterAIEditModal';
import RetranslateModal from '../../../components/RetranslateModal';

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
  const [isRetranslateModalOpen, setIsRetranslateModalOpen] = useState(false);

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

  const isTranslatedLanguage = useMemo(() => {
    if (!activeLanguage) return false;
    // Show retranslate for any language that isn't the primary language
    return activeLanguage !== primaryLanguage && availableLanguages.includes(activeLanguage);
  }, [activeLanguage, primaryLanguage, availableLanguages]);

  const translationTimestamp = useMemo(() => {
    if (!activeVersion || !isTranslatedLanguage) return null;
    return activeVersion.timestamp;
  }, [activeVersion, isTranslatedLanguage]);

  const sourceLanguage = useMemo(() => {
    // Source language is always the primary language
    return primaryLanguage;
  }, [primaryLanguage]);

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

      // Get translation function schema
      const translationFunctionSchema = getTranslationFunctionSchema('chapterContent');

      // Get provider config from settings
      const settingsStore = useSettingsStore.getState();
      const storyObjectStore = useStoryObjectStore.getState();
      const translationConfig = settingsStore.getFunctionConfig('translation');
      const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

      // Create temporary abort controller
      const abortController = new AbortController();
      const abortControllerRef = { current: abortController };

      // Promise to wait for translation result
      let resolveTranslation: (value: string) => void;
      let rejectTranslation: (error: Error) => void;
      const translationPromise = new Promise<string>((resolve, reject) => {
        resolveTranslation = resolve;
        rejectTranslation = reject;
      });

      // Setup ChatManager callbacks
      const callbacks: ChatManagerCallbacks = {
        onUpdateMessage: () => {},
        onSyncMessageToBackend: async () => {},
        onFunctionCalls: async (projId, chatId, messageId, functionCalls: FunctionCallMetadata[]) => {
          try {
            // Create translation context
            const translationContext: TranslationContext = {
              projectId,
              targetLanguage: normalizedTarget,
              chapterId: selectedChapter.id,
              versionId: activeVersion.id,
            };

            // Apply translation function calls
            const results = await applyTranslationFunctionCalls(functionCalls, translationContext);

            const failedResults = results.filter(r => !r.success);
            if (failedResults.length > 0) {
              rejectTranslation(new Error(`Translation failed: ${failedResults.map(r => r.error).join(', ')}`));
            } else {
              // Get translated content from result
              const result = results[0];
              const translatedContent = result.data?.translatedText || result.data?.content;
              resolveTranslation(translatedContent);
            }
          } catch (err) {
            console.error('Translation function application error:', err);
            rejectTranslation(err instanceof Error ? err : new Error('Failed to apply translation'));
          }
        },
        onAddMessage: async () => `msg-${Date.now()}`,
        onGetChatHistory: () => [],
        onError: (err) => {
          rejectTranslation(err);
        },
      };

      // Create ChatManager config
      const tempChatId = `temp-chapter-translation-${Date.now()}`;
      const chatManagerConfig: ChatManagerConfig = {
        projectId,
        getStoryObjects: () => storyObjectStore.getStoryObjects(projectId),
        systemInsertConfig: {
          promptContext: {
            sourceLanguage: fallback.language,
            targetLanguage: normalizedTarget,
            dataType: 'chapterContent',
            sourceData: {
              content: fallback.data.content,
              wordCount: fallback.data.wordCount ?? getWordCount(fallback.data.content),
            },
            enablePrefill: translationConfig.advanced.enablePrefill,
            enableThinking: translationConfig.advanced.thinkingMode !== 'off',
          },
          promptType: 'translation',
        },
        chatPipeline: new ChatPipeline(),
        getIsLoading: () => false,
        setIsLoading: () => {},
        abortControllerRef,
        getActiveChatId: () => tempChatId,
        getConversationLanguage: () => normalizedTarget,
        provider: translationConfig.provider,
        providerConfig,
        aiModel: translationConfig.model,
        temperature: translationConfig.temperature,
        providerPreference: translationConfig.providerPreference,
        functions: [translationFunctionSchema],
        mode: 'novelEditor',
        enablePrefill: translationConfig.advanced.enablePrefill,
        thinkingMode: translationConfig.advanced.thinkingMode as any,
        reasoningConfig: translationConfig.advanced.reasoningConfig,
      };

      // Create ChatManager
      const chatManager = new ChatManager(chatManagerConfig, callbacks);

      // Process translation request
      const userMessage: ChatMessage = {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: `Please translate this chapter content from ${fallback.language} to ${normalizedTarget}`,
        timestamp: new Date(),
      };

      await chatManager.processUserMessage(userMessage);

      // Wait for translation result
      const translatedContent = await translationPromise;

      // Update chapter content with translation
      await updateChapterContentForLanguage(projectId, selectedChapter.id, translatedContent, normalizedTarget, 'Translation', true);

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
  }, [activeLanguage, activeVersion, updateChapterContentForLanguage, availableLanguages, getWordCount, primaryLanguage, projectId, selectedChapter, showError, uiActions]);

  const retranslateChapter = useCallback(async (includePrevious: boolean, userInstructions: string) => {
    if (!selectedChapter || !activeVersion) return;

    const normalizedTarget = activeLanguage.trim();
    if (!normalizedTarget) return;

    // Get source data
    const fallback = TranslationService.getBestLanguageData(activeVersion.data, activeLanguage, primaryLanguage);
    if (!fallback) {
      showError('Retranslation Failed', 'No source content is available to retranslate from.');
      return;
    }

    // Get previous translation if requested
    const previousTranslation = includePrevious && activeLanguageEntry
      ? activeLanguageEntry.content
      : undefined;

    const translationKey = `${selectedChapter.id}:${normalizedTarget}:retranslate`;

    try {
      setIsTranslating(true);
      setTranslationError(null);
      setIsRetranslateModalOpen(false);
      TranslationService.setTranslationStatus(translationKey, { objectId: translationKey, isTranslating: true });

      // Get translation function schema
      const translationFunctionSchema = getTranslationFunctionSchema('chapterContent');

      // Get provider config from settings
      const settingsStore = useSettingsStore.getState();
      const storyObjectStore = useStoryObjectStore.getState();
      const translationConfig = settingsStore.getFunctionConfig('translation');
      const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

      // Create temporary abort controller
      const abortController = new AbortController();
      const abortControllerRef = { current: abortController };

      // Promise to wait for translation result
      let resolveTranslation: (value: string) => void;
      let rejectTranslation: (error: Error) => void;
      const translationPromise = new Promise<string>((resolve, reject) => {
        resolveTranslation = resolve;
        rejectTranslation = reject;
      });

      // Setup ChatManager callbacks
      const callbacks: ChatManagerCallbacks = {
        onUpdateMessage: () => {},
        onSyncMessageToBackend: async () => {},
        onFunctionCalls: async (projId, chatId, messageId, functionCalls: FunctionCallMetadata[]) => {
          try {
            // Create translation context
            const translationContext: TranslationContext = {
              projectId,
              targetLanguage: normalizedTarget,
              chapterId: selectedChapter.id,
              versionId: activeVersion.id,
            };

            // Apply translation function calls
            const results = await applyTranslationFunctionCalls(functionCalls, translationContext);

            const failedResults = results.filter(r => !r.success);
            if (failedResults.length > 0) {
              rejectTranslation(new Error(`Retranslation failed: ${failedResults.map(r => r.error).join(', ')}`));
            } else {
              // Get translated content from result
              const result = results[0];
              const translatedContent = result.data?.translatedText || result.data?.content;
              resolveTranslation(translatedContent);
            }
          } catch (err) {
            console.error('Retranslation function application error:', err);
            rejectTranslation(err instanceof Error ? err : new Error('Failed to apply retranslation'));
          }
        },
        onAddMessage: async () => `msg-${Date.now()}`,
        onGetChatHistory: () => [],
        onError: (err) => {
          rejectTranslation(err);
        },
      };

      // Create ChatManager config with retranslation-specific context
      const tempChatId = `temp-chapter-retranslation-${Date.now()}`;
      const chatManagerConfig: ChatManagerConfig = {
        projectId,
        getStoryObjects: () => storyObjectStore.getStoryObjects(projectId),
        systemInsertConfig: {
          promptContext: {
            sourceLanguage: fallback.language,
            targetLanguage: normalizedTarget,
            dataType: 'chapterContent',
            sourceData: {
              content: fallback.data.content,
              wordCount: fallback.data.wordCount ?? getWordCount(fallback.data.content),
            },
            previousTranslation,
            userInstructions: userInstructions || undefined,
            enablePrefill: translationConfig.advanced.enablePrefill,
            enableThinking: translationConfig.advanced.thinkingMode !== 'off',
          },
          promptType: 'translation',
        },
        chatPipeline: new ChatPipeline(),
        getIsLoading: () => false,
        setIsLoading: () => {},
        abortControllerRef,
        getActiveChatId: () => tempChatId,
        getConversationLanguage: () => normalizedTarget,
        provider: translationConfig.provider,
        providerConfig,
        aiModel: translationConfig.model,
        temperature: translationConfig.temperature,
        providerPreference: translationConfig.providerPreference,
        functions: [translationFunctionSchema],
        mode: 'novelEditor',
        enablePrefill: translationConfig.advanced.enablePrefill,
        thinkingMode: translationConfig.advanced.thinkingMode as any,
        reasoningConfig: translationConfig.advanced.reasoningConfig,
      };

      // Create ChatManager
      const chatManager = new ChatManager(chatManagerConfig, callbacks);

      // Process retranslation request
      const userMessageContent = userInstructions
        ? `Please retranslate this chapter content from ${fallback.language} to ${normalizedTarget} with the following instructions: ${userInstructions}`
        : `Please retranslate this chapter content from ${fallback.language} to ${normalizedTarget}`;

      const userMessage: ChatMessage = {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: userMessageContent,
        timestamp: new Date(),
      };

      await chatManager.processUserMessage(userMessage);

      // Wait for translation result
      const translatedContent = await translationPromise;

      // Update chapter content with retranslation
      const updateReason = userInstructions ? `Retranslation: ${userInstructions}` : 'Retranslation';
      await updateChapterContentForLanguage(projectId, selectedChapter.id, translatedContent, normalizedTarget, updateReason, true);

      setContent(translatedContent);
      setLastSavedContent(translatedContent);
      uiActions.setEditorContent(translatedContent);
      isUserEditingRef.current = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown retranslation error.';
      setTranslationError(message);
      showError('Retranslation Failed', message);
    } finally {
      setIsTranslating(false);
      TranslationService.clearTranslationStatus(translationKey);
    }
  }, [activeLanguage, activeLanguageEntry, activeVersion, getWordCount, primaryLanguage, projectId, selectedChapter, showError, uiActions, updateChapterContentForLanguage]);

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

  const handleAIEditResult = useCallback(() => {
    if (!selectedChapter) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    try {
      // The modal already updated the content, so we just need to reload it
      const chapterContent = getChapterContent(projectId, selectedChapter.id);
      if (chapterContent) {
        const activeVersionData = chapterContent.versions.find(v => v.is_active);
        if (activeVersionData) {
          const languageEntry = activeVersionData.data[activeLanguage];
          if (languageEntry) {
            setContent(languageEntry.content);
            setLastSavedContent(languageEntry.content);
            uiActions.setEditorContent(languageEntry.content);
            isUserEditingRef.current = false;
          }
        }
      }
    } catch (error) {
      console.error('Error reloading after AI edit:', error);
      const message = error instanceof Error ? error.message : 'Unknown error while reloading content.';
      showError('Reload Failed', message);
    }
  }, [activeLanguage, getChapterContent, projectId, selectedChapter, showError, uiActions]);

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

          {/* Custom Language Input */}
          <form className="custom-language-form" onSubmit={handleCustomLanguageSubmit} style={{ marginTop: '8px' }}>
            <input
              type="text"
              value={customLanguage}
              onChange={(event) => setCustomLanguage(event.target.value)}
              placeholder="Other language (e.g., Spanish)"
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
            {isTranslatedLanguage && (
              <button
                className="toolbar-btn retranslate-btn"
                onClick={() => setIsRetranslateModalOpen(true)}
                disabled={isTranslating}
                title="Retranslate this chapter with new instructions"
              >
                🔄 Retranslate
              </button>
            )}
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

      <RetranslateModal
        isOpen={isRetranslateModalOpen}
        onClose={() => setIsRetranslateModalOpen(false)}
        sourceLanguage={sourceLanguage}
        targetLanguage={activeLanguage}
        translationTimestamp={translationTimestamp}
        onRetranslate={retranslateChapter}
        isTranslating={isTranslating}
      />
    </div>
  );
};

export default NovelEditorPanel;

