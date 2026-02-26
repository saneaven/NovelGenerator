import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useProjectStore } from '../../store/projectStore';
import { ImageGenerationModal } from '../ImageGeneration';
import ImagePromptManager from './ImagePromptManager';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { assetService, formatStyledPrompt, type Asset } from '../../api/assetService';
import { getAssetUrl } from '../../utils/assetUrl';
import { Folder, AIAssistMini, Close } from '../icons';
import { VirtualizedImageGrid } from './VirtualizedImageGrid';
import ToggleSwitch from '../common/ToggleSwitch';
import type { DisplayAsset } from './ImageGridItem';
import { ImageTaskRuntime, type GenerationRecipe } from '../../imageTask';
import { useImageTaskStore } from '../../imageTask/store';
import { fromAsset } from '../../imageTask/recipe/fromAsset';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import './ImageTabContent.css';

// Basic asset info needed for display
type AssetLike = {
    id: string;
    name: string;
    width?: number | null;
    height?: number | null;
    file_url: string;
    file_size?: number | null;
    created_at: string;
    generation_provider?: string | null;
    generation_model?: string | null;
    generation_prompt?: { prefix?: string; content?: string; postfix?: string } | null;
    generation_positive_prompt?: { prefix?: string; content?: string; postfix?: string } | null;
    generation_negative_prompt?: { prefix?: string; content?: string; postfix?: string } | null;
    generation_settings?: Record<string, unknown> | null;
};

type SubTabType = 'library' | 'prompt';

// Content mode determines what data to display and what actions are available
export type ImageContentMode = 'object' | 'scene' | 'picker';

interface ImageTabContentProps {
    // Mode (defaults to 'object' for backward compatibility)
    mode?: ImageContentMode;

    // Object mode props (existing)
    objectType?: string;
    objectId?: string;
    onAssetChange?: () => void;

    // Scene mode props
    manuscriptId?: string;  // For scene mode: ownership filtering

    // Picker mode props
    onSelect?: (asset: Asset) => void;
    excludeAssetIds?: string[];

    // Selection change callback (for parent to track selected asset)
    onSelectionChange?: (asset: Asset | null) => void;

    // UI toggles (auto-determined by mode if not specified)
    showImportButton?: boolean;
    showPromptTab?: boolean;

    // Scene context for AI assist (passed to ImageGenerationModal)
    sceneContext?: { preContext: string; postContext: string };

    // Image generation callback (for parent to receive generated images)
    onImageGenerated?: (asset: Asset) => void;

    // Optional initial recipe for generation UI (e.g., retry flow)
    initialGenerationRecipe?: GenerationRecipe | null;
}

const ImageTabContent: React.FC<ImageTabContentProps> = ({
    mode = 'object',
    objectType,
    objectId,
    onAssetChange,
    manuscriptId,
    onSelect,
    excludeAssetIds = [],
    onSelectionChange,
    showImportButton: showImportButtonProp,
    showPromptTab: showPromptTabProp,
    sceneContext,
    onImageGenerated: onImageGeneratedProp,
    initialGenerationRecipe,
}) => {
    const { currentProjectId } = useProjectStore();
    const imageTaskSessions = useImageTaskStore((s) => s.sessions);
    const {
        assets,
        storyObjectAssets,
        sceneAssets,
        isLoading,
        error,
        fetchAssets,
        fetchStoryObjectAssets,
        fetchSceneAssets,
        getStoryObjectAssets,
        uploadAsset,
        updateAsset,
        deleteAsset,
        setMainAsset,
        clearError,
    } = useAssetStore();

    // Determine UI visibility based on mode
    const showImportButton = showImportButtonProp ?? (mode !== 'picker');
    const showPromptTab = showPromptTabProp ?? (mode === 'object');

    const [activeSubTab, setActiveSubTab] = useState<SubTabType>('library');
    const [searchQuery, setSearchQuery] = useState('');
    const [showAllChapters, setShowAllChapters] = useState(false);
    const [successModalAsset, setSuccessModalAsset] = useState<Asset | null>(null);
    const [assetName, setAssetName] = useState('');
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
    const [showImportDropdown, setShowImportDropdown] = useState(false);
    const [showGeneratePanel, setShowGeneratePanel] = useState(false);
    const [generationRecipe, setGenerationRecipe] = useState<GenerationRecipe | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [moreDropdownAssetId, setMoreDropdownAssetId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const importButtonRef = useRef<HTMLDivElement>(null);
    const moreDropdownRef = useRef<HTMLDivElement>(null);
    const gridScrollContainerRef = useRef<HTMLDivElement>(null);

    // Fetch data based on mode
    useEffect(() => {
        if (!currentProjectId) return;

        if (mode === 'object' && objectType && objectId) {
            fetchStoryObjectAssets(currentProjectId, objectType, objectId);
        } else if (mode === 'scene') {
            // If showAllChapters is true, fetch all scene assets (no manuscriptId filter)
            // Otherwise, fetch only assets owned by current manuscript
            fetchSceneAssets(currentProjectId, showAllChapters ? undefined : manuscriptId);
        } else if (mode === 'picker') {
            // Picker mode: fetch all assets or scene assets
            fetchAssets(currentProjectId);
        }
    }, [currentProjectId, mode, objectType, objectId, manuscriptId, showAllChapters, fetchStoryObjectAssets, fetchSceneAssets, fetchAssets]);

    // Auto-open generate panel when an initial recipe is provided (e.g., retry flow)
    useEffect(() => {
        if (!initialGenerationRecipe) return;
        setGenerationRecipe(initialGenerationRecipe);
        setShowGeneratePanel(true);
    }, [initialGenerationRecipe]);

    const closeGeneratePanel = useCallback(() => {
        setShowGeneratePanel(false);
        setGenerationRecipe(null);
    }, []);

    // Get linked assets with is_main info (for object mode)
    const linkedAssets = useMemo(() => {
        if (mode !== 'object' || !objectType || !objectId) return [];
        return getStoryObjectAssets(objectType, objectId);
    }, [mode, objectType, objectId, storyObjectAssets, getStoryObjectAssets]);

    // Get display assets based on mode
    const displayAssets = useMemo((): DisplayAsset[] => {
        if (mode === 'object') {
            return linkedAssets.map(link => ({
                kind: 'asset',
                id: link.asset.id,
                linkId: link.id,
                asset: link.asset,
                is_main: link.is_main,
            }));
        } else if (mode === 'scene') {
            return sceneAssets.map(asset => ({
                kind: 'asset',
                id: asset.id,
                asset: asset,
                usage_count: asset.usage_count,
                used_in_manuscripts: asset.used_in_manuscripts,
            }));
        } else {
            // Picker mode: show all assets
            return assets.map(asset => ({
                kind: 'asset',
                id: asset.id,
                asset,
            }));
        }
    }, [mode, linkedAssets, sceneAssets, assets]);

    const placeholderItems = useMemo((): DisplayAsset[] => {
        if (!currentProjectId) return [];
        if (mode === 'picker') return [];
        if (mode === 'object' && (!objectType || !objectId)) return [];
        if (mode === 'scene' && !showAllChapters && !manuscriptId) return [];

        return Object.values(imageTaskSessions)
            .filter((s): s is NonNullable<typeof s> => !!s)
            .filter((s) => s.input.projectId === currentProjectId)
            .filter((s) => s.status === 'running' || s.status === 'error' || s.status === 'cancelled')
            .filter((s) => {
                const b = s.input.binding;
                if (mode === 'object') {
                    return b.type === 'object' && b.objectType === objectType && b.objectId === objectId;
                }
                if (mode === 'scene') {
                    if (b.type !== 'scene') return false;
                    if (showAllChapters) return true;
                    return b.manuscriptId === manuscriptId;
                }
                return false;
            })
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((s) => ({
                kind: 'placeholder' as const,
                id: `task:${s.id}`,
                taskId: s.id,
                status: s.status as 'running' | 'error' | 'cancelled',
                stage: s.progress?.stage,
                message:
                    s.status === 'running'
                        ? (s.progress?.message ?? 'Working...')
                        : s.status === 'error'
                            ? (s.error ?? 'An error occurred')
                            : 'Cancelled',
                error: s.status === 'error' ? s.error : undefined,
                binding: s.input.binding,
                recipe: s.input.recipe,
            }));
    }, [currentProjectId, mode, objectType, objectId, manuscriptId, showAllChapters, imageTaskSessions]);

    // Filter by search query
    const filteredAssets = useMemo(() => {
        if (!searchQuery) return displayAssets;
        return displayAssets.filter((item) =>
            item.kind === 'asset' && item.asset.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [displayAssets, searchQuery]);

    const combinedItems = useMemo((): DisplayAsset[] => {
        return [...placeholderItems, ...filteredAssets];
    }, [placeholderItems, filteredAssets]);

    // Dropdown file upload handler
    const handleDropdownFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || !currentProjectId) return;

        // Determine asset type based on mode
        const assetType = mode === 'scene' ? 'scene' : (mode === 'object' ? 'object' : undefined);
        const binding =
            mode === 'scene'
                ? (manuscriptId ? { manuscriptId } : null)
                : (mode === 'object'
                    ? ((objectType && objectId) ? { objectType, objectId } : null)
                    : null);

        if (mode === 'scene' && !manuscriptId) {
            showAlert({ title: 'Import Image', message: 'Select a chapter first (scene assets must be linked to a manuscript).' });
            return;
        }
        if (mode === 'object' && (!objectType || !objectId)) {
            showAlert({ title: 'Import Image', message: 'No object is selected (object assets must be linked to a story object).' });
            return;
        }

        for (const file of Array.from(files)) {
            try {
                const newAsset = await uploadAsset(currentProjectId, file, file.name, assetType, binding ?? undefined);
                setSuccessModalAsset(newAsset);
                setAssetName(file.name.replace(/\.[^/.]+$/, ''));
                setShowImportDropdown(false);
            } catch (err) {
                // Error handled in store
            }
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Drag and drop handlers
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer.files;
        if (files.length > 0 && currentProjectId) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                // Determine asset type based on mode
                const assetType = mode === 'scene' ? 'scene' : (mode === 'object' ? 'object' : undefined);
                const binding =
                    mode === 'scene'
                        ? (manuscriptId ? { manuscriptId } : null)
                        : (mode === 'object'
                            ? ((objectType && objectId) ? { objectType, objectId } : null)
                            : null);

                if (mode === 'scene' && !manuscriptId) {
                    showAlert({ title: 'Import Image', message: 'Select a chapter first (scene assets must be linked to a manuscript).' });
                    return;
                }
                if (mode === 'object' && (!objectType || !objectId)) {
                    showAlert({ title: 'Import Image', message: 'No object is selected (object assets must be linked to a story object).' });
                    return;
                }

                uploadAsset(currentProjectId, file, file.name, assetType, binding ?? undefined).then((newAsset) => {
                    setSuccessModalAsset(newAsset);
                    setAssetName(file.name.replace(/\.[^/.]+$/, ''));
                    setShowImportDropdown(false);
                });
            }
        }
    }, [currentProjectId, uploadAsset, mode, manuscriptId, objectType, objectId]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                importButtonRef.current && !importButtonRef.current.contains(e.target as Node)) {
                setShowImportDropdown(false);
            }
        };

        if (showImportDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showImportDropdown]);

    // Close dropdown on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowImportDropdown(false);
            }
        };

        if (showImportDropdown) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [showImportDropdown]);

    // Clear active asset when clicking outside the grid (for mobile)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const targetNode = e.target as Node | null;
            const gridEl = gridScrollContainerRef.current;
            if (!gridEl || !targetNode || !gridEl.contains(targetNode)) {
                setActiveAssetId(null);
                setSelectedAssetId(null);
            }
        };

        if (activeAssetId) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [activeAssetId]);

    // Close more dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (moreDropdownRef.current && !moreDropdownRef.current.contains(e.target as Node)) {
                setMoreDropdownAssetId(null);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setMoreDropdownAssetId(null);
            }
        };

        if (moreDropdownAssetId) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
                document.removeEventListener('keydown', handleKeyDown);
            };
        }
    }, [moreDropdownAssetId]);

    const handleSetMain = async (assetId: string) => {
        if (!currentProjectId || !objectType || !objectId) return;
        try {
            await setMainAsset(currentProjectId, objectType, objectId, assetId);
            onAssetChange?.();
        } catch (err) {
            // Error handled in store
        }
    };

    const handleDeleteAsset = async (asset: AssetLike) => {
        if (!currentProjectId) return;

        // Check if it's a scene asset with usage info
        const sceneAsset = sceneAssets.find(sa => sa.id === asset.id);
        const usageWarning = sceneAsset && sceneAsset.usage_count > 0
            ? `\n\nWarning: This image is used in ${sceneAsset.usage_count} manuscript${sceneAsset.usage_count > 1 ? 's' : ''}:\n${sceneAsset.used_in_manuscripts.map(m => `• ${m.act_name ? m.act_name + ' - ' : ''}${m.name}`).join('\n')}`
            : '';

        const confirmed = await confirm({
            title: 'Delete Image',
            message: `Are you sure you want to delete "${asset.name}"?${usageWarning}`,
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (!confirmed) return;

        try {
            await deleteAsset(currentProjectId, asset.id);
            // Refresh the appropriate list
            if (mode === 'scene') {
                await fetchSceneAssets(currentProjectId, showAllChapters ? undefined : manuscriptId);
            } else if (mode === 'object' && objectType && objectId) {
                await fetchStoryObjectAssets(currentProjectId, objectType, objectId, true);
            } else {
                await fetchAssets(currentProjectId);
            }
            onAssetChange?.();
            setDetailAsset(null);
            setMoreDropdownAssetId(null);
        } catch (err) {
            // Error handled in store
        }
    };

    const handleStartRename = (asset: AssetLike) => {
        setEditingAssetId(asset.id);
        setEditingName(asset.name);
    };

    const handleSaveRename = async (assetId: string) => {
        if (!currentProjectId || !editingName.trim()) {
            setEditingAssetId(null);
            return;
        }
        try {
            await updateAsset(currentProjectId, assetId, editingName.trim());
            // Refresh the appropriate list
            if (mode === 'scene') {
                await fetchSceneAssets(currentProjectId, showAllChapters ? undefined : manuscriptId);
            } else if (mode === 'object' && objectType && objectId) {
                await fetchStoryObjectAssets(currentProjectId, objectType, objectId, true);
            } else {
                await fetchAssets(currentProjectId);
            }
        } catch (err) {
            // Error handled in store
        }
        setEditingAssetId(null);
    };

    // Refresh after import (upload is already bound server-side)
    const refreshAfterImport = async (asset: Asset) => {
        if (!currentProjectId) return;

        if (mode === 'object' && objectType && objectId) {
            await fetchStoryObjectAssets(currentProjectId, objectType, objectId, true);
        } else if (mode === 'scene') {
            await fetchSceneAssets(currentProjectId, showAllChapters ? undefined : manuscriptId);
        } else {
            await fetchAssets(currentProjectId);
        }

        onAssetChange?.();

        if (onSelect) {
            onSelect(asset);
        }

        setActiveSubTab('library');
    };

    const handleImageGenerated = async (asset: Asset) => {
        setGenerationRecipe(null);
        try {
            if (!currentProjectId) return;
            if (mode === 'scene') {
                await fetchSceneAssets(currentProjectId, showAllChapters ? undefined : manuscriptId);
            } else if (mode === 'object' && objectType && objectId) {
                await fetchStoryObjectAssets(currentProjectId, objectType, objectId, true);
            } else {
                await fetchAssets(currentProjectId);
            }
            onAssetChange?.();
        } catch (err) {
            // Error handled in store
        }

        // Also notify parent if callback provided
        onImageGeneratedProp?.(asset);
    };

    const handleAssetClick = (item: DisplayAsset) => {
        if (item.kind !== 'asset') return;
        if (mode === 'scene' || mode === 'picker') {
            // For scene/picker: select the asset and fix hover state
            setSelectedAssetId(item.id);
            setActiveAssetId(item.id);
            // Notify parent of selection change
            onSelectionChange?.(item.asset as Asset);
        }
        // For object mode: just fix hover state (done in onClick)
    };

    const handleOpenDetail = (asset: AssetLike) => {
        setDetailAsset(asset as Asset);
        setMoreDropdownAssetId(null);
    };

    const handleRegenerateAsset = useCallback(async (assetId: string) => {
        setMoreDropdownAssetId(null);
        if (!currentProjectId) return;

        // Regeneration still needs a binding (scene -> manuscript, object -> object)
        if (mode === 'scene' && !manuscriptId) {
            showAlert({ title: 'Regenerate Image', message: 'No chapter context is selected for scene image generation.' });
            return;
        }
        if (mode === 'object' && (!objectType || !objectId)) {
            showAlert({ title: 'Regenerate Image', message: 'No object is selected for image generation.' });
            return;
        }

        try {
            const fullAsset = await assetService.getAsset(currentProjectId, assetId);
            const recipe = fromAsset(fullAsset);
            if (!recipe) {
                showAlert({ title: 'Regenerate Image', message: 'This image has no saved generation settings.' });
                return;
            }
            setGenerationRecipe(recipe);
            setShowGeneratePanel(true);
        } catch (err) {
            showAlert({ title: 'Regenerate Image', message: 'Failed to load generation settings for this image.' });
        }
    }, [currentProjectId, mode, manuscriptId, objectType, objectId]);

    const handleCancelTask = useCallback((taskId: string) => {
        ImageTaskRuntime.cancel(taskId);
    }, []);

    const handleRetryTask = useCallback((_taskId: string, recipe: GenerationRecipe) => {
        setGenerationRecipe(recipe);
        setShowGeneratePanel(true);
        useImageTaskStore.getState().clearSession(_taskId);
    }, []);

    const handleDismissTask = useCallback((taskId: string) => {
        useImageTaskStore.getState().clearSession(taskId);
    }, []);

    const formatFileSize = (bytes: number | null): string => {
        if (!bytes) return 'Unknown';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (dateStr: string): string => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getProviderDisplayName = (provider: string | null): string => {
        if (!provider) return 'Unknown';
        const names: Record<string, string> = {
            openai: 'OpenAI',
            gemini: 'Google Gemini',
            xai: 'xAI (Grok)',
            novelai: 'NovelAI',
        };
        return names[provider] || provider;
    };

    const handleSuccessModalSave = async () => {
        if (!successModalAsset || !currentProjectId) return;

        try {
            // Rename if name changed
            if (assetName.trim() && assetName !== successModalAsset.name) {
                await updateAsset(currentProjectId, successModalAsset.id, assetName.trim());
            }

            await refreshAfterImport(successModalAsset);
            setSuccessModalAsset(null);
        } catch (err) {
            // Error handled in store
        }
    };

    return (
        <div className="image-tab-content">
            {/* Tab header with subtabs and import button */}
            <div className="image-tab-header">
                <div className="image-tab-subtabs">
                    <button
                        className={`subtab-button ${activeSubTab === 'library' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('library')}
                    >
                        Library
                    </button>
                    {showPromptTab && (
                        <button
                            className={`subtab-button ${activeSubTab === 'prompt' ? 'active' : ''}`}
                            onClick={() => setActiveSubTab('prompt')}
                        >
                            Prompt
                        </button>
                    )}
                </div>

                {/* Scene mode filter toggle - show only when manuscriptId is available */}
                {mode === 'scene' && manuscriptId && (
                    <div className="scene-filter-toggle">
                        <ToggleSwitch
                            checked={showAllChapters}
                            onChange={setShowAllChapters}
                            label={showAllChapters ? 'All Chapters' : 'Current Chapter'}
                        />
                    </div>
                )}

                {showImportButton && (
                    <div className="import-button-wrapper" ref={importButtonRef}>
                        <TextButton
                            variant="primary"
                            size="sm"
                            onClick={() => setShowImportDropdown(!showImportDropdown)}
                        >
                            + Import
                    </TextButton>

                    {/* Import Dropdown */}
                    {showImportDropdown && (
                        <div className="import-dropdown" ref={dropdownRef}>
                            <div
                                className={`import-dropzone ${isDragOver ? 'drag-over' : ''}`}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <div className="dropzone-icon"><Folder size="2xl" /></div>
                                <div className="dropzone-text">
                                    <span className="dropzone-primary">Drop image here</span>
                                    <span className="dropzone-secondary">or click to browse</span>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleDropdownFileUpload}
                                    style={{ display: 'none' }}
                                />
                            </div>

                            <div className="import-dropdown-divider" />

                            <TextButton
                                variant="primary"
                                size="sm"
                                fullWidth
                                iconLeft={<AIAssistMini size="md" />}
                                onClick={() => {
                                    setShowGeneratePanel(true);
                                    setShowImportDropdown(false);
                                }}
                            >
                                Generate with AI
                            </TextButton>
                        </div>
                    )}
                    </div>
                )}
            </div>

            {/* Sub-tab content */}
            <div className="image-tab-body">
                {activeSubTab === 'library' && (
                    <div className="library-subtab">
                        <div className="search-bar">
                            <input
                                type="text"
                                placeholder="Search images..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="search-input"
                            />
                        </div>

                        {isLoading && <div className="loading">Loading...</div>}

                        {error && (
                            <div className="error-banner">
                                {error}
                                <button onClick={clearError}>&times;</button>
                            </div>
                        )}

                        <VirtualizedImageGrid
                            items={combinedItems}
                            mode={mode}
                            scrollResetKey={mode === 'scene' ? `${manuscriptId ?? 'all'}:${showAllChapters ? 'all' : 'current'}` : mode}
                            activeAssetId={activeAssetId}
                            selectedAssetId={selectedAssetId}
                            excludeAssetIds={excludeAssetIds}
                            editingAssetId={editingAssetId}
                            editingName={editingName}
                            moreDropdownAssetId={moreDropdownAssetId}
                            moreDropdownRef={moreDropdownRef}
                            scrollContainerRef={gridScrollContainerRef}
                            onItemClick={handleAssetClick}
                            onSetActiveAssetId={setActiveAssetId}
                            onSetMain={handleSetMain}
                            onStartRename={handleStartRename}
                            onEditingNameChange={setEditingName}
                            onSaveRename={handleSaveRename}
                            onCancelRename={() => setEditingAssetId(null)}
                            onOpenDetail={handleOpenDetail}
                            onDeleteAsset={handleDeleteAsset}
                            onToggleMoreDropdown={setMoreDropdownAssetId}
                            onCancelTask={handleCancelTask}
                            onRetryTask={handleRetryTask}
                            onDismissTask={handleDismissTask}
                            onRegenerateAsset={handleRegenerateAsset}
                        />

                        {combinedItems.length === 0 && !isLoading && (
                            <div className="empty-state">
                                {searchQuery
                                    ? 'No images match your search'
                                    : mode === 'scene'
                                        ? 'No scene images yet. Generate or upload scene images from the chapter editor.'
                                        : 'No images yet. Upload or generate one!'}
                            </div>
                        )}
                    </div>
                )}

                {activeSubTab === 'prompt' && objectType && objectId && (
                    <div className="prompt-subtab">
                        <ImagePromptManager
                            objectType={objectType}
                            objectId={objectId}
                        />
                    </div>
                )}
            </div>

            {/* Success Modal */}
            {successModalAsset && (
                <div className="success-modal-overlay" onClick={() => setSuccessModalAsset(null)}>
                    <div className="success-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="success-modal-header">
                            <h3>Image Created</h3>
                            <IconButton size="xs" icon={<Close size="sm" />} onClick={() => setSuccessModalAsset(null)} variant="ghost" />
                        </div>
                        <div className="success-modal-body">
                            <div className="success-image-preview">
                                <img
                                    src={getAssetUrl(successModalAsset) || ''}
                                    alt="Preview"
                                />
                            </div>
                            <div className="success-form">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={assetName}
                                    onChange={(e) => setAssetName(e.target.value)}
                                    placeholder="Enter image name"
                                />
                            </div>
                        </div>
                        <div className="success-modal-footer">
                            <TextButton variant="secondary" onClick={() => setSuccessModalAsset(null)}>
                                Cancel
                            </TextButton>
                            <TextButton variant="primary" onClick={handleSuccessModalSave}>
                                Save
                            </TextButton>
                        </div>
                    </div>
                </div>
            )}

            {/* Asset Detail Modal */}
            {detailAsset && (
                <div className="asset-detail-overlay" onClick={() => setDetailAsset(null)}>
                    <div className="asset-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="asset-detail-header">
                            <h3>Image Details</h3>
                            <IconButton size="xs" icon={<Close size="sm" />} onClick={() => setDetailAsset(null)} variant="ghost" />
                        </div>
                        <div className="asset-detail-body">
                            <div className="asset-detail-image">
                                <img
                                    src={getAssetUrl(detailAsset) || ''}
                                    alt={detailAsset.name}
                                />
                            </div>
                            <div className="asset-detail-info">
                                <div className="asset-detail-section">
                                    <h4>Basic Info</h4>
                                    <div className="detail-row">
                                        <span className="detail-label">Name</span>
                                        <span className="detail-value">{detailAsset.name}</span>
                                    </div>
                                    {detailAsset.width && detailAsset.height && (
                                        <div className="detail-row">
                                            <span className="detail-label">Dimensions</span>
                                            <span className="detail-value">{detailAsset.width} × {detailAsset.height}</span>
                                        </div>
                                    )}
                                    <div className="detail-row">
                                        <span className="detail-label">File Size</span>
                                        <span className="detail-value">{formatFileSize(detailAsset.file_size)}</span>
                                    </div>
                                    <div className="detail-row">
                                        <span className="detail-label">Created</span>
                                        <span className="detail-value">{formatDate(detailAsset.created_at)}</span>
                                    </div>
                                </div>

                                {detailAsset.generation_provider && (
                                    <div className="asset-detail-section">
                                        <h4>Generation Info</h4>
                                        <div className="detail-row">
                                            <span className="detail-label">Provider</span>
                                            <span className="detail-value">{getProviderDisplayName(detailAsset.generation_provider)}</span>
                                        </div>
                                        {detailAsset.generation_model && (
                                            <div className="detail-row">
                                                <span className="detail-label">Model</span>
                                                <span className="detail-value">{detailAsset.generation_model}</span>
                                            </div>
                                        )}

                                        {detailAsset.generation_prompt && (
                                            <div className="detail-row vertical">
                                                <span className="detail-label">Prompt</span>
                                                <div className="detail-prompt-box">
                                                    {formatStyledPrompt(detailAsset.generation_prompt)}
                                                </div>
                                            </div>
                                        )}

                                        {detailAsset.generation_positive_prompt && (
                                            <div className="detail-row vertical">
                                                <span className="detail-label">Positive Prompt</span>
                                                <div className="detail-prompt-box positive">
                                                    {formatStyledPrompt(detailAsset.generation_positive_prompt)}
                                                </div>
                                            </div>
                                        )}
                                        {detailAsset.generation_negative_prompt && (
                                            <div className="detail-row vertical">
                                                <span className="detail-label">Negative Prompt</span>
                                                <div className="detail-prompt-box negative">
                                                    {formatStyledPrompt(detailAsset.generation_negative_prompt)}
                                                </div>
                                            </div>
                                        )}

                                        {detailAsset.generation_settings && Object.keys(detailAsset.generation_settings).length > 0 && (
                                            <div className="detail-row vertical">
                                                <span className="detail-label">Settings</span>
                                                <div className="detail-settings-list">
                                                    {Object.entries(detailAsset.generation_settings).map(([key, value]) => (
                                                        <div key={key} className="setting-item">
                                                            <span className="setting-key">{key}:</span>
                                                            <span className="setting-value">{String(value)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="asset-detail-footer">
                            <TextButton variant="secondary" onClick={() => setDetailAsset(null)}>
                                Close
                            </TextButton>
                        </div>
                    </div>
                </div>
            )}

            {/* Generate Panel (shown when Generate with AI is clicked) */}
            {showGeneratePanel && (
                <div
                    className="generate-panel-overlay"
                    onClick={closeGeneratePanel}
                >
                    <div className="generate-panel" onClick={(e) => e.stopPropagation()}>
                        <ImageGenerationModal
                            onImageGenerated={handleImageGenerated}
                            onClose={closeGeneratePanel}
                            objectType={objectType}
                            objectId={objectId}
                            manuscriptId={manuscriptId}
                            initialRecipe={generationRecipe}
                            sceneContext={sceneContext}
                            assetType={mode === 'scene' ? 'scene' : 'object'}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImageTabContent;
