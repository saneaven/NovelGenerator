/**
 * NovelEditorPanel - Novel Writing Interface
 *
 * Core Features:
 * - Rich text editor for chapter content
 * - Auto-cache to localStorage (persists across refresh, no backend calls)
 * - Manual save creates version snapshots (backend call)
 * - Word count tracking
 * - Save status indicators
 *
 * AI Features:
 * - AI Edit modal for content improvement
 * - Chat integration for AI assistance
 * - Function calling for AI-generated content
 *
 * Translation Features:
 * - Multi-language support
 * - Language switcher
 * - AI translation (via Translation Modal)
 *
 * Version Management:
 * - Manual version creation via Save Snapshot button
 * - Version history sidebar
 * - Version restoration
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import NovelChapterAIEditModal from '../../../components/NovelChapterAIEditModal';
import TranslationModal from '../../../components/TranslationModal';
import { AssetManagerModal, SceneAssetManagerModal } from '../../../components/AssetManager';
import SceneImageGeneratorModal from '../../../components/ImageGeneration/SceneImageGeneratorModal';
import { RichTextEditor, type RichTextEditorRef } from '../../../components/RichTextEditor';
import RegenerationComparisonOverlay from '../../../components/RichTextEditor/RegenerationComparisonOverlay';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { useAssetStore } from '../../../store/assetStore';
import { assetService, type Asset } from '../../../api/assetService';
import type { ManuscriptObject } from '../../../types/unifiedObject';
import type { InitialGenerationSettings } from '../../../components/ImageGeneration/SceneImageGeneratorModal';
import { API_BASE_URL } from '../../../api/client';
import ChapterSidebar from './ChapterSidebar';
import { Save, Check, Bullet, Warning, HamburgerMenu, AIAssist, Refresh, Globe, Lightbulb, MoreHorizontal } from '../../../components/icons';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';

interface NovelEditorPanelProps {
  projectId: string;
  selectedChapter: {
    id: string;
    name: string;
    description: string;
    order: number;
    actId: string;
  } | null;
  selectedChapterId: string | null;
  hasChapters: boolean;
  chaptersInitialized: boolean;
  onSelectChapter: (chapterId: string) => void;
}

// Constants
const AUTO_SAVE_DELAY = 2000; // 2 seconds
const CACHE_KEY_PREFIX = 'novel_editor_cache_';

// Helper to get localStorage cache key for manuscript content
const getCacheKey = (manuscriptId: string, language: string) =>
  `${CACHE_KEY_PREFIX}${manuscriptId}_${language}`;

const NovelEditorPanel: React.FC<NovelEditorPanelProps> = ({
  projectId,
  selectedChapter,
  selectedChapterId,
  hasChapters,
  chaptersInitialized,
  onSelectChapter,
}) => {
  // Granular selectors to avoid unnecessary re-renders (Zustand best practice)
  const storeObjects = useUnifiedObjectStore((state) => state.objects);
  const storeLoading = useUnifiedObjectStore((state) => state.loading);
  const storeErrors = useUnifiedObjectStore((state) => state.errors);

  // Actions accessed via getState() - doesn't trigger re-renders
  const listObjects = useUnifiedObjectStore.getState().listObjects;
  const fetchObject = useUnifiedObjectStore.getState().fetchObject;
  const updateObject = useUnifiedObjectStore.getState().updateObject;
  const createObject = useUnifiedObjectStore.getState().createObject;
  const addTranslation = useUnifiedObjectStore.getState().addTranslation;
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();
  const editorStore = useNovelEditorStore();
  // Get stable action references to avoid infinite loops in effects
  const setHasUnsavedChangesAction = useNovelEditorStore((state) => state.setHasUnsavedChanges);
  const setIsSavingAction = useNovelEditorStore((state) => state.setIsSaving);

  // Sidebar state from unified sidebar store
  const toggleSidebar = useSidebarStore((state) => state.toggleSidebar);

  // Get UI state from store
  const globalDisplayLanguage = editorStore.getDisplayLanguage(projectId) || settings.mainLanguage;

  // State
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  const [isResolvingContentId, setIsResolvingContentId] = useState(false);
  const [contentIdError, setContentIdError] = useState<string | null>(null);
  const [isAIEditModalOpen, setIsAIEditModalOpen] = useState(false);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showImageGeneratorModal, setShowImageGeneratorModal] = useState(false);
  const [showSceneAssetManagerModal, setShowSceneAssetManagerModal] = useState(false);
  const [cursorContext, setCursorContext] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // Image overlay regeneration state
  const [regenerateAsset, setRegenerateAsset] = useState<Asset | null>(null);
  const [pendingRegenerationBounds, setPendingRegenerationBounds] = useState<DOMRect | null>(null);
  const [regenerationComparison, setRegenerationComparison] = useState<{
    originalSrc: string;
    originalAsset: Asset;
    newAsset: Asset;
  } | null>(null);
  // Image replace state
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);

  // Asset store for uploading images
  const { uploadAsset } = useAssetStore();

  // Editor state
  const [content, setContent] = useState('');
  const [lastSavedContent, setLastSavedContent] = useState('');
  const isSaving = useNovelEditorStore((state) => state.isSavingByProject[projectId] ?? false);
  const setIsSaving = (saving: boolean) => setIsSavingAction(projectId, saving);
  const [savingType, setSavingType] = useState<'auto' | 'manual' | null>(null);

  // Refs
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  // Track if baseline has been set for current editor instance
  // This ensures we compare normalized content vs normalized content (not DB format)
  const baselineSetRef = useRef(false);

  // Get manuscript from store
  const manuscript = manuscriptId
    ? (storeObjects[manuscriptId] as ManuscriptObject)
    : null;
  const loading = manuscriptId ? (storeLoading[manuscriptId] || false) : false;
  const error = manuscriptId ? (storeErrors[manuscriptId] || null) : null;

  // Get available languages from manuscript data
  const manuscriptLanguages = useMemo(() => {
    if (!manuscript) return [];
    return Object.keys(manuscript.data);
  }, [manuscript]);

  // Computed: Check if current language translation is missing
  const isMissingTranslation = useMemo(() => {
    if (!manuscript) return false;
    return !manuscriptLanguages.includes(globalDisplayLanguage);
  }, [manuscript, manuscriptLanguages, globalDisplayLanguage]);

  // Computed: Available source languages for translation
  const availableSourceLanguages = useMemo(() => {
    return manuscriptLanguages;
  }, [manuscriptLanguages]);

  // Compute effective display language with fallback
  // globalDisplayLanguage is now the actual language string (e.g., 'English', 'Korean')
  const { effectiveLanguage, isFallback } = useMemo(() => {
    if (!manuscript) {
      return { effectiveLanguage: globalDisplayLanguage || settings.mainLanguage, isFallback: false };
    }
    if (manuscriptLanguages.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    // Fallback to first available or mainLanguage
    return { effectiveLanguage: manuscriptLanguages[0] || settings.mainLanguage, isFallback: true };
  }, [manuscript, manuscriptLanguages, globalDisplayLanguage, settings.mainLanguage]);

  // Helper to get manuscript data for a language
  const getManuscriptData = useCallback((lang: string) => {
    if (!manuscript) return { content: '', wordCount: 0 };
    const data = manuscript.data[lang];
    if (data) {
      return data;
    }
    // Fallback to first available
    if (manuscriptLanguages.length > 0) {
      const fallbackData = manuscript.data[manuscriptLanguages[0]];
      return fallbackData || { content: '', wordCount: 0 };
    }
    return { content: '', wordCount: 0 };
  }, [manuscript, manuscriptLanguages]);


  // Find existing manuscript
  const existingManuscript = useMemo(() => {
    if (!selectedChapterId) return null;
    const matchingObject = Object.values(storeObjects).find(
      (obj) =>
        obj.type === 'manuscript' && obj.metadata?.chapter_id === selectedChapterId
    ) as ManuscriptObject | undefined;
    return matchingObject || null;
  }, [selectedChapterId, storeObjects]);

  // Computed values
  const wordCount = useMemo(() => {
    return content.trim().split(/\s+/).filter(Boolean).length;
  }, [content]);

  const hasUnsavedChanges = content !== lastSavedContent;

  // Generate editor key - changes trigger editor remount for external content updates
  // This replaces the fragile isSettingContentRef approach with React's key mechanism
  // Include globalDisplayLanguage to ensure remount when user switches display language
  // Fixes bug where switching to main language after AI Edit showed empty content
  const editorKey = useMemo(() => {
    if (!manuscript) return 'loading';
    return `${manuscriptId}-${manuscript.version?.number ?? 0}-${globalDisplayLanguage}-${effectiveLanguage}`;
  }, [manuscriptId, manuscript?.version?.number, globalDisplayLanguage, effectiveLanguage]);

  // Compute initial content INLINE during render (not in an effect!)
  // This ensures the value is ready BEFORE the editor mounts with a new key
  const initialContent = useMemo(() => {
    if (!manuscript?.data || editorKey === 'loading') return '';
    return getManuscriptData(effectiveLanguage).content;
  }, [manuscript?.data, editorKey, effectiveLanguage, getManuscriptData]);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Resolve manuscript object ID when chapter selection changes
  useEffect(() => {
    let isActive = true;

    const resolveManuscriptId = async () => {
      if (!projectId || !selectedChapterId) {
        if (!isActive) return;
        setManuscriptId(null);
        setContentIdError(null);
        setIsResolvingContentId(false);
        return;
      }

      if (existingManuscript) {
        if (!isActive) return;
        setManuscriptId(existingManuscript.id);
        setContentIdError(null);
        setIsResolvingContentId(false);
        return;
      }

      setIsResolvingContentId(true);
      setContentIdError(null);

      try {
        const manuscripts = await listObjects('manuscript', projectId);
        if (!isActive) return;

        const matchingManuscript = manuscripts.find(
          (m) => m.metadata?.chapter_id === selectedChapterId
        );

        if (matchingManuscript) {
          setManuscriptId(matchingManuscript.id);
          return;
        }

        // Create new manuscript if it doesn't exist
        const primaryLanguage = settings.mainLanguage || 'en';
        const createdManuscript = await createObject(
          'manuscript',
          projectId,
          {
            content: '',
            wordCount: 0,
          },
          primaryLanguage,
          { chapter_id: selectedChapterId }
        );

        if (!isActive) return;
        setManuscriptId(createdManuscript.id);
      } catch (err) {
        if (!isActive) return;
        setManuscriptId(null);
        setContentIdError('Failed to load or create manuscript.');
      } finally {
        if (isActive) {
          setIsResolvingContentId(false);
        }
      }
    };

    // Defer to avoid flushSync conflict with TipTap editor during React render phase
    queueMicrotask(() => {
      resolveManuscriptId();
    });

    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    selectedChapterId,
    existingManuscript,
    settings.mainLanguage,
  ]);

  // Fetch manuscript when ID available or language changes
  useEffect(() => {
    if (!manuscriptId) return;

    // Set a timeout to prevent infinite loading
    loadingTimeoutRef.current = setTimeout(() => {
      if (!manuscript && loading) {
        console.error('Loading timeout - forcing error state');
        setContentIdError('Loading timeout. The manuscript is taking too long to load. Please try refreshing.');
      }
    }, 10000); // 10 second timeout

    // Defer to avoid flushSync conflict with TipTap editor during React render phase
    queueMicrotask(() => {
      // Fetch without language parameter - API returns all languages
      // effectiveLanguage (with fallback logic) will pick the right content
      fetchObject('manuscript', manuscriptId).catch((err: Error) => {
        console.error('Failed to fetch manuscript:', err);
        setContentIdError(err.message || 'Failed to load manuscript');
      });
    });

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [manuscriptId]); // Only re-fetch when manuscriptId changes

  // Reset baseline flag when editor remounts (editorKey changes)
  // The actual content/lastSavedContent will be set by handleContentChange on first onChange
  useEffect(() => {
    baselineSetRef.current = false;
  }, [editorKey]);

  // Restore content from localStorage cache if available and newer than server data
  useEffect(() => {
    if (!manuscriptId || !effectiveLanguage || !manuscript) return;

    const cacheKey = getCacheKey(manuscriptId, effectiveLanguage);
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      try {
        const { content: cachedContent, savedAt } = JSON.parse(cached);
        const serverUpdatedAt = new Date(manuscript.version?.created_at || 0).getTime();

        // Only restore if cache is newer than server data
        if (savedAt > serverUpdatedAt) {
          setContent(cachedContent);
          // Don't set lastSavedContent - this keeps hasUnsavedChanges true
          // so user knows there's unsaved work
        }
      } catch (err) {
        console.error('Failed to restore from cache:', err);
        localStorage.removeItem(cacheKey);
      }
    }
  }, [manuscriptId, effectiveLanguage, manuscript?.version?.created_at]);

  // Sync hasUnsavedChanges to the store for cross-component access
  useEffect(() => {
    setHasUnsavedChangesAction(projectId, hasUnsavedChanges);
  }, [projectId, hasUnsavedChanges, setHasUnsavedChangesAction]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // ============================================================================
  // SAVE HANDLERS
  // ============================================================================

  /**
   * Auto-save: Save to localStorage only (NO backend call)
   * Called on every keystroke after debounce delay
   */
  const handleAutoSave = useCallback(() => {
    if (!manuscriptId || !hasUnsavedChanges) return;

    // Save to localStorage only - NO backend API call
    const cacheKey = getCacheKey(manuscriptId, effectiveLanguage);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        content,
        wordCount,
        savedAt: Date.now(),
      }));
    } catch (err) {
      console.error('localStorage save failed:', err);
    }
  }, [manuscriptId, content, wordCount, hasUnsavedChanges, effectiveLanguage]);

  /**
   * Manual save: Creates version snapshot
   * Called when user clicks Save button
   */
  const handleManualSave = useCallback(
    async (reason: string = 'Manual Save') => {
      if (!manuscript || !manuscriptId) return;

      setIsSaving(true);
      setSavingType('manual');

      try {
        await updateObject('manuscript', manuscriptId, {
          data: {
            content,
            wordCount,
          },
          language: effectiveLanguage,
          user_request: reason,
          create_new_version: true, // CREATE VERSION SNAPSHOT
        });

        setLastSavedContent(content);

        // Clear localStorage cache after successful save
        const cacheKey = getCacheKey(manuscriptId, effectiveLanguage);
        localStorage.removeItem(cacheKey);
      } catch (err) {
        console.error('Manual save failed:', err);
        showError('Save Error', 'Failed to save. Please try again.');
      } finally {
        setIsSaving(false);
        setSavingType(null);
      }
    },
    [manuscript, manuscriptId, content, wordCount, effectiveLanguage, showError]
  );

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleContentChange = useCallback(
    (newContent: string) => {
      // First onChange after editor mount: set baseline
      // This ensures we compare normalized content vs normalized content
      // (TipTap normalizes whitespace during markdown→HTML→markdown conversion)
      if (!baselineSetRef.current) {
        baselineSetRef.current = true;
        setContent(newContent);
        setLastSavedContent(newContent); // Both set to normalized format
        return; // Don't trigger auto-save on baseline init
      }

      // Subsequent changes: normal behavior
      setContent(newContent);

      // Clear existing auto-save timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Schedule new auto-save
      autoSaveTimeoutRef.current = setTimeout(() => {
        handleAutoSave();
      }, AUTO_SAVE_DELAY);
    },
    [handleAutoSave]
  );

  // Handle image selection from AssetManagerModal
  const handleImageSelect = useCallback((asset: Asset) => {
    const newSrc = `${API_BASE_URL}${asset.file_url}`;

    // If we're replacing an existing image
    if (replaceImageSrc && editorRef.current) {
      // Use the editor's updateImageSrc method to replace the image
      const updated = editorRef.current.updateImageSrc(replaceImageSrc, newSrc, asset.name);

      if (!updated) {
        console.warn('Failed to find and update image:', { from: replaceImageSrc, to: newSrc });
      }

      setReplaceImageSrc(null);
      setShowAssetModal(false);
      return;
    }

    // Normal insert at cursor
    if (editorRef.current) {
      editorRef.current.insertImage(newSrc, asset.name);
    }
    setShowAssetModal(false);
  }, [replaceImageSrc]);

  // Handle file upload from ImageInsertMenu drag-drop
  const handleFileUpload = useCallback(async (file: File) => {
    if (!projectId) return;

    try {
      const asset = await uploadAsset(projectId, file, file.name);
      if (asset && editorRef.current) {
        editorRef.current.insertImage(`${API_BASE_URL}${asset.file_url}`, asset.name);
      }
    } catch (err) {
      console.error('Failed to upload image:', err);
      showError('Upload Error', 'Failed to upload image. Please try again.');
    }
  }, [projectId, uploadAsset, showError]);

  // Handle browse assets - opens AssetManagerModal in picker mode
  const handleBrowseAssets = useCallback(() => {
    if (editorRef.current) {
      const context = editorRef.current.getTextAroundCursor();
      setCursorContext(context);
    }
    setShowAssetModal(true);
  }, []);

  // Handle generate image - opens SceneImageGeneratorModal
  const handleGenerateImage = useCallback(() => {
    if (editorRef.current) {
      const context = editorRef.current.getTextAroundCursor();
      setCursorContext(context);
    }
    setShowImageGeneratorModal(true);
  }, []);

  // Handle manage scene assets - opens SceneAssetManagerModal
  const handleManageSceneAssets = useCallback(() => {
    setShowSceneAssetManagerModal(true);
  }, []);

  // Handle generated image from SceneImageGeneratorModal
  const handleImageGenerated = useCallback((asset: Asset) => {
    // If we're in regeneration mode, show comparison UI instead of auto-inserting
    if (regenerateAsset && pendingRegenerationBounds) {
      setRegenerationComparison({
        originalSrc: `${API_BASE_URL}${regenerateAsset.file_url}`,
        originalAsset: regenerateAsset,
        newAsset: asset,
      });
      setShowImageGeneratorModal(false);
      return;
    }

    // Normal generation - insert at cursor
    if (editorRef.current) {
      editorRef.current.insertImage(`${API_BASE_URL}${asset.file_url}`, asset.name);
    }
  }, [regenerateAsset, pendingRegenerationBounds]);

  // Handle replace image from overlay - opens AssetManagerModal
  const handleReplaceImage = useCallback((currentSrc: string) => {
    setReplaceImageSrc(currentSrc);
    setShowAssetModal(true);
  }, []);

  // Handle regenerate image from overlay - opens SceneImageGeneratorModal with settings
  const handleRegenerateImage = useCallback((asset: Asset, imageBounds: DOMRect) => {
    setRegenerateAsset(asset);
    setPendingRegenerationBounds(imageBounds);
    // Get cursor context for scene context
    if (editorRef.current) {
      const context = editorRef.current.getTextAroundCursor();
      setCursorContext(context);
    }
    setShowImageGeneratorModal(true);
  }, []);

  // Get asset by URL for ImageNodeView overlay
  const getAssetByUrl = useCallback(async (src: string): Promise<Asset | null> => {
    if (!projectId) return null;
    return assetService.getAssetByUrl(projectId, src);
  }, [projectId]);

  // Convert Asset to InitialGenerationSettings for regeneration
  const getInitialSettings = useCallback((asset: Asset): InitialGenerationSettings => {
    const settings: InitialGenerationSettings = {};

    // Natural language prompt (extract content from StyledPrompt)
    if (asset.generation_prompt) {
      settings.prompt = asset.generation_prompt.content;
    }

    // Tag-based prompts (NovelAI) - extract content from StyledPrompt
    if (asset.generation_positive_prompt) {
      settings.positivePrompt = asset.generation_positive_prompt.content;
    }
    if (asset.generation_negative_prompt) {
      settings.negativePrompt = asset.generation_negative_prompt.content;
    }

    // Provider and model
    if (asset.generation_provider) {
      settings.provider = asset.generation_provider as InitialGenerationSettings['provider'];
    }
    if (asset.generation_model) {
      settings.model = asset.generation_model;
    }

    // Provider-specific settings from generation_settings JSON
    const genSettings = asset.generation_settings as Record<string, unknown> | null;
    if (genSettings) {
      // Size
      if (typeof genSettings.size === 'string') {
        settings.size = genSettings.size;
      }

      // Gemini settings
      if (typeof genSettings.aspect_ratio === 'string') {
        settings.geminiAspectRatio = genSettings.aspect_ratio;
      }
      if (typeof genSettings.image_resolution === 'string') {
        settings.geminiResolution = genSettings.image_resolution;
      }

      // OpenAI settings
      if (genSettings.quality === 'standard' || genSettings.quality === 'hd') {
        settings.openaiQuality = genSettings.quality;
      }
      if (genSettings.style === 'natural' || genSettings.style === 'vivid') {
        settings.openaiStyle = genSettings.style;
      }

      // NovelAI settings
      if (typeof genSettings.sampler === 'string') {
        settings.novelaiSampler = genSettings.sampler;
      }
      if (typeof genSettings.steps === 'number') {
        settings.novelaiSteps = genSettings.steps;
      }
      if (typeof genSettings.scale === 'number') {
        settings.novelaiScale = genSettings.scale;
      }
      if (typeof genSettings.noise_schedule === 'string') {
        settings.novelaiNoiseSchedule = genSettings.noise_schedule;
      }

      // Style IDs
      if (typeof genSettings.natural_style_id === 'string') {
        settings.selectedNaturalStyleId = genSettings.natural_style_id;
      }
      if (typeof genSettings.tag_based_style_id === 'string') {
        settings.selectedTagBasedStyleId = genSettings.tag_based_style_id;
      }
    }

    return settings;
  }, []);

  // Handle use regenerated image - replace original with new in editor
  const handleUseRegeneratedImage = useCallback(() => {
    if (!regenerationComparison || !editorRef.current) return;

    const { originalSrc, newAsset } = regenerationComparison;
    const newSrc = `${API_BASE_URL}${newAsset.file_url}`;

    // Use the editor's updateImageSrc method to replace the image
    const updated = editorRef.current.updateImageSrc(originalSrc, newSrc, newAsset.name);

    if (!updated) {
      console.warn('Failed to find and update image:', { originalSrc, newSrc });
    }

    // Clear comparison state
    setRegenerationComparison(null);
    setRegenerateAsset(null);
    setPendingRegenerationBounds(null);
  }, [regenerationComparison]);

  // Handle discard regenerated image - keep original, new stays in library
  const handleDiscardRegeneratedImage = useCallback(() => {
    setRegenerationComparison(null);
    setRegenerateAsset(null);
    setPendingRegenerationBounds(null);
  }, []);

  const handleAIEditComplete = useCallback(() => {
    // Reload the manuscript after AI edit
    if (manuscriptId) {
      fetchObject('manuscript', manuscriptId);
    }
  }, [manuscriptId]);

  // Handle "Write from scratch" - create new translation with empty content
  const handleWriteFromScratch = useCallback(async () => {
    if (!manuscriptId) return;

    try {
      // Add the current language as a new translation with empty content
      await addTranslation('manuscript', manuscriptId, {
        language: globalDisplayLanguage,
        data: { content: '', wordCount: 0 }
      });

      // Re-fetch to get the new translation
      // isMissingTranslation will be computed automatically after fetch
      await fetchObject('manuscript', manuscriptId);
    } catch (err) {
      console.error('Failed to create new translation:', err);
      showError('Error', 'Failed to create new content. Please try again.');
    }
  }, [manuscriptId, globalDisplayLanguage, showError]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!selectedChapterId) {
    const isChapterMissing = chaptersInitialized && !hasChapters;
    const heading = isChapterMissing
      ? 'No Chapters Available'
      : chaptersInitialized
        ? 'Loading chapter...'
        : 'Loading chapters...';
    const description = isChapterMissing
      ? 'Create chapters in the Workspace to start writing.'
      : chaptersInitialized
        ? 'Opening the first available chapter. Please wait.'
        : 'Loading your outline so we can open the first chapter.';

    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>{heading}</h2>
          <p>{description}</p>
        </div>
      </div>
    );
  }

  if (isResolvingContentId) {
    return (
      <div className="novel-editor-panel loading">
        <div className="spinner" />
        <p>Loading chapter content...</p>
      </div>
    );
  }

  if (contentIdError) {
    return (
      <div className="novel-editor-panel error">
        <h3>Chapter Content Error</h3>
        <p>{contentIdError}</p>
      </div>
    );
  }

  if (loading && !manuscript) {
    return (
      <div className="novel-editor-panel loading">
        <div className="spinner" />
        <p>Loading manuscript...</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem' }}>
          Manuscript ID: {manuscriptId}
        </p>
        <div style={{ marginTop: '1rem' }}>
          <TextButton
            variant="secondary"
            onClick={() => {
              if (manuscriptId) {
                fetchObject('manuscript', manuscriptId);
              }
            }}
          >
            Retry
          </TextButton>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="novel-editor-panel error">
        <h3>Error Loading Chapter</h3>
        <p>{error}</p>
        <TextButton
          variant="secondary"
          onClick={() => manuscriptId && fetchObject('manuscript', manuscriptId)}
        >
          Retry
        </TextButton>
      </div>
    );
  }

  if (!manuscript) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>Manuscript Not Found</h2>
          <p>This chapter doesn't have manuscript content yet.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="novel-editor-panel">
        <div className="editor-main">
          {/* Chapter Header */}
          {selectedChapter && (
            <div className="editor-header">
              <div className="editor-info">
                <div className="editor-title-row">
                  {/* Mobile-only: Save status icon */}
                  <div className="mobile-save-status">
                    {isSaving && <span className="saving-indicator" title="Saving..."><Save size="sm" /></span>}
                    {!isSaving && hasUnsavedChanges && <span className="unsaved-indicator" title="Unsaved"><Bullet size="sm" /></span>}
                    {!isSaving && !hasUnsavedChanges && <span className="saved-indicator" title="Saved"><Check size="sm" /></span>}
                  </div>

                  <h2
                    className={`editor-chapter-title ${selectedChapter.description ? 'has-description' : ''}`}
                    onClick={selectedChapter.description ? () => setIsDescriptionExpanded(!isDescriptionExpanded) : undefined}
                    title={selectedChapter.description ? (isDescriptionExpanded ? 'Hide description' : 'Show description') : undefined}
                  >
                    {selectedChapter.name}
                  </h2>

                  {/* Desktop: Status Info - Save status + Word count (stacked vertically) */}
                  <div className="editor-status-info">
                    <div className="save-status">
                      {isSaving && savingType === 'auto' && <span className="saving-indicator"><Save size="xs" /> Auto-saving...</span>}
                      {isSaving && savingType === 'manual' && <span className="saving-indicator"><Save size="xs" /> Saving...</span>}
                      {!isSaving && hasUnsavedChanges && <span className="unsaved-indicator"><Bullet size="xs" /> Unsaved</span>}
                      {!isSaving && !hasUnsavedChanges && <span className="saved-indicator"><Check size="xs" /> Saved</span>}
                    </div>
                    <div className="word-count">
                      <span>{wordCount.toLocaleString()} words</span>
                    </div>
                  </div>

                  {/* Fallback Warning */}
                  {isFallback && (
                    <span className="fallback-warning" title={`${globalDisplayLanguage} not available, showing ${effectiveLanguage}`}>
                      <Warning size="sm" /> {effectiveLanguage}
                    </span>
                  )}

                  {/* Sidebar Toggle Button */}
                  <IconButton
                    icon={<HamburgerMenu size="md" />}
                    onClick={() => toggleSidebar(projectId, 'chapter')}
                    title="Toggle chapter list"
                    size="sm"
                    className="sidebar-toggle-btn"
                  />
                </div>

                {/* Collapsible Description */}
                {selectedChapter.description && (
                  <div className={`editor-chapter-description-wrapper ${isDescriptionExpanded ? 'expanded' : ''}`}>
                    <p className="editor-chapter-description">{selectedChapter.description}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className={`editor-content ${isMissingTranslation ? 'disabled' : ''}`}>
            <RichTextEditor
              key={editorKey}
              ref={editorRef}
              initialContent={isMissingTranslation ? '' : initialContent}
              onChange={handleContentChange}
              placeholder="Start writing your chapter..."
              disabled={isSaving || isMissingTranslation}
              onFileUpload={handleFileUpload}
              onBrowseAssets={handleBrowseAssets}
              onGenerateImage={handleGenerateImage}
              onManageSceneAssets={handleManageSceneAssets}
              projectId={projectId}
              onReplaceImage={handleReplaceImage}
              onRegenerateImage={handleRegenerateImage}
              getAssetByUrl={getAssetByUrl}
              toolbarActions={
                <>
                  {/* AI Edit Button */}
                  <TextButton
                    variant="primary"
                    size="sm"
                    onClick={() => setIsAIEditModalOpen(true)}
                    disabled={isSaving || !selectedChapter}
                    title="AI Edit Chapter"
                    iconLeft={<AIAssist size="sm" />}
                    className="desktop-only"
                  >
                    AI Edit
                  </TextButton>

                  {/* Manual Save Button */}
                  <TextButton
                    variant="secondary"
                    size="sm"
                    onClick={() => handleManualSave('Manual Save')}
                    disabled={isSaving || !hasUnsavedChanges}
                    title="Create version snapshot (Ctrl+S)"
                    iconLeft={<Save size="sm" />}
                    className="desktop-only"
                  >
                    Save
                  </TextButton>

                  {/* More Actions Dropdown - contains mobile-hidden actions */}
                  <DropdownMenu
                    trigger={
                      <IconButton
                        icon={<MoreHorizontal size="sm" />}
                        disabled={isSaving}
                        title="More actions"
                        size="sm"
                      />
                    }
                  >
                    {/* AI Edit - accessible via dropdown on mobile */}
                    <DropdownItem
                      icon={<AIAssist size="sm" />}
                      label="AI Edit"
                      onClick={() => setIsAIEditModalOpen(true)}
                      disabled={isSaving || !selectedChapter}
                      className="mobile-only-item"
                    />
                    {/* Save - accessible via dropdown on mobile */}
                    <DropdownItem
                      icon={<Save size="sm" />}
                      label="Save"
                      onClick={() => handleManualSave('Manual Save')}
                      disabled={isSaving || !hasUnsavedChanges}
                      className="mobile-only-item"
                    />
                    {/* Show Translate/Retranslate only when sub languages exist */}
                    {settings.subLanguages && settings.subLanguages.length > 0 && (
                      manuscriptLanguages.includes(globalDisplayLanguage) ? (
                        <DropdownItem
                          icon={<Refresh size="sm" />}
                          label="Retranslate"
                          onClick={() => setShowRetranslateModal(true)}
                          disabled={isSaving}
                        />
                      ) : (
                        <DropdownItem
                          icon={<Globe size="sm" />}
                          label="Translate"
                          onClick={() => setShowRetranslateModal(true)}
                          disabled={isSaving || !manuscript}
                        />
                      )
                    )}
                  </DropdownMenu>
                </>
              }
            />
            {/* Missing Translation Overlay */}
            {isMissingTranslation && (
              <div className="missing-translation-overlay">
                <div className="overlay-content">
                  <h3>No content in {globalDisplayLanguage}</h3>
                  <p>This chapter doesn't have content in {globalDisplayLanguage} yet.</p>
                  <div className="overlay-actions">
                    {availableSourceLanguages.length > 0 && (
                      <TextButton
                        variant="primary"
                        onClick={() => setShowRetranslateModal(true)}
                      >
                        Translate from {availableSourceLanguages[0]}
                      </TextButton>
                    )}
                    <TextButton
                      variant="secondary"
                      onClick={handleWriteFromScratch}
                    >
                      Write from scratch
                    </TextButton>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="editor-footer">
            <div className="editor-footer-info">
              <span>Language: {effectiveLanguage}</span>
              <span>•</span>
              <span>Version: {manuscript.version.number}</span>
            </div>
            <div className="editor-footer-notice">
              <Lightbulb size="sm" /> Auto-cached locally • Click Save to create version
            </div>
          </div>
        </div>

        {/* Chapter Sidebar */}
        <ChapterSidebar
          projectId={projectId}
          selectedChapterId={selectedChapterId}
          onSelectChapter={onSelectChapter}
          displayLanguage={globalDisplayLanguage}
        />
      </div>

      {/* AI Edit Modal */}
      {selectedChapter && (
        <NovelChapterAIEditModal
          isOpen={isAIEditModalOpen}
          onClose={() => setIsAIEditModalOpen(false)}
          projectId={projectId}
          chapterId={selectedChapter.id}
          chapterName={selectedChapter.name}
          onResult={handleAIEditComplete}
        />
      )}

      {/* Translation Modal */}
      {manuscript && manuscriptId && (
        <TranslationModal
          isOpen={showRetranslateModal}
          onClose={() => setShowRetranslateModal(false)}
          projectId={projectId}
          onComplete={() => setShowRetranslateModal(false)}
          allowedObjectTypes={['manuscript']}
          preSelectedObjectIds={[manuscriptId]}
          defaultSourceLanguage={
            isMissingTranslation && availableSourceLanguages.length > 0
              ? availableSourceLanguages[0]
              : manuscriptLanguages[0] || settings.mainLanguage
          }
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}

      {/* Asset Manager Modal for browsing/selecting existing images */}
      <AssetManagerModal
        isOpen={showAssetModal}
        onClose={() => setShowAssetModal(false)}
        onSelect={handleImageSelect}
        title="Select Image"
      />

      {/* Scene Image Generator Modal */}
      <SceneImageGeneratorModal
        isOpen={showImageGeneratorModal}
        onClose={() => {
          setShowImageGeneratorModal(false);
          setRegenerateAsset(null);
          setPendingRegenerationBounds(null);
        }}
        onImageGenerated={handleImageGenerated}
        sceneContext={{
          preContext: cursorContext.before,
          postContext: cursorContext.after,
        }}
        initialSettings={regenerateAsset ? getInitialSettings(regenerateAsset) : undefined}
        mode={regenerateAsset ? 'regenerate' : 'generate'}
      />

      {/* Scene Asset Manager Modal */}
      <SceneAssetManagerModal
        isOpen={showSceneAssetManagerModal}
        onClose={() => setShowSceneAssetManagerModal(false)}
      />

      {/* Regeneration Comparison Overlay */}
      <RegenerationComparisonOverlay
        isOpen={!!regenerationComparison}
        newAsset={regenerationComparison?.newAsset ?? null}
        onUse={handleUseRegeneratedImage}
        onDiscard={handleDiscardRegeneratedImage}
      />
    </>
  );
};

export default NovelEditorPanel;
