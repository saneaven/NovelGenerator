import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useProjectStore } from '../../store/projectStore';
import { ImageGenerationModal } from '../ImageGeneration';
import ImagePromptManager from './ImagePromptManager';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { formatStyledPrompt, type Asset, type SceneAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import { Star, Edit, Folder, AIAssistMini, Close, MoreHorizontal, Trash, Info } from '../icons';
import './ImageTabContent.css';

// Basic asset info needed for display
type AssetLike = {
    id: string;
    name: string;
    width?: number | null;
    height?: number | null;
    file_url: string;
    thumbnail_url?: string | null;
    file_size?: number | null;
    created_at: string;
    generation_provider?: string | null;
    generation_model?: string | null;
    generation_prompt?: { prefix?: string; content?: string; postfix?: string } | null;
    generation_positive_prompt?: { prefix?: string; content?: string; postfix?: string } | null;
    generation_negative_prompt?: { prefix?: string; content?: string; postfix?: string } | null;
    generation_settings?: Record<string, unknown> | null;
};

// Calculate grid span based on image aspect ratio
function calculateGridSpan(asset: AssetLike | null, baseRowHeight: number = 10): { rowSpan: number; colSpan: number } {
    if (!asset?.width || !asset?.height) {
        return { rowSpan: 15, colSpan: 1 }; // Default square-ish
    }

    const ratio = asset.width / asset.height;
    const baseWidth = 150; // Approximate column width in pixels

    // Landscape images span 2 columns
    const colSpan = ratio > 1.5 ? 2 : 1;

    // Calculate row span based on aspect ratio
    const effectiveWidth = baseWidth * colSpan;
    const calculatedHeight = effectiveWidth / ratio;
    const rowSpan = Math.ceil(calculatedHeight / baseRowHeight);

    return { rowSpan, colSpan };
}

type SubTabType = 'library' | 'prompt';

// Content mode determines what data to display and what actions are available
export type ImageContentMode = 'object' | 'scene' | 'picker';

export interface RegenerateSettings {
    provider: string;
    model: string;
    prompt?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    size?: string;
    settings?: Record<string, any>;
}

interface ImageTabContentProps {
    // Mode (defaults to 'object' for backward compatibility)
    mode?: ImageContentMode;

    // Object mode props (existing)
    objectType?: string;
    objectId?: string;
    onAssetChange?: () => void;

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
    // Initial settings for regeneration mode
    initialGenerationSettings?: {
        prompt?: string;
        positivePrompt?: string;
        negativePrompt?: string;
        provider?: string;
        model?: string;
        size?: string;
        settings?: Record<string, any>;
    };
}

const ImageTabContent: React.FC<ImageTabContentProps> = ({
    mode = 'object',
    objectType,
    objectId,
    onAssetChange,
    onSelect,
    excludeAssetIds = [],
    onSelectionChange,
    showImportButton: showImportButtonProp,
    showPromptTab: showPromptTabProp,
    sceneContext,
    onImageGenerated: onImageGeneratedProp,
    initialGenerationSettings,
}) => {
    const { currentProjectId } = useProjectStore();
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
        linkAssetToObject,
        clearError,
    } = useAssetStore();

    // Determine UI visibility based on mode
    const showImportButton = showImportButtonProp ?? (mode !== 'picker');
    const showPromptTab = showPromptTabProp ?? (mode === 'object');

    const [activeSubTab, setActiveSubTab] = useState<SubTabType>('library');
    const [searchQuery, setSearchQuery] = useState('');
    const [successModalAsset, setSuccessModalAsset] = useState<Asset | null>(null);
    const [assetName, setAssetName] = useState('');
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
    const [regenerateSettings, setRegenerateSettings] = useState<RegenerateSettings | null>(null);
    const [showImportDropdown, setShowImportDropdown] = useState(false);
    const [showGeneratePanel, setShowGeneratePanel] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [moreDropdownAssetId, setMoreDropdownAssetId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const importButtonRef = useRef<HTMLDivElement>(null);
    const moreDropdownRef = useRef<HTMLDivElement>(null);

    // Fetch data based on mode
    useEffect(() => {
        if (!currentProjectId) return;

        if (mode === 'object' && objectType && objectId) {
            fetchStoryObjectAssets(currentProjectId, objectType, objectId);
        } else if (mode === 'scene') {
            fetchSceneAssets(currentProjectId);
        } else if (mode === 'picker') {
            // Picker mode: fetch all assets or scene assets
            fetchAssets(currentProjectId);
        }
    }, [currentProjectId, mode, objectType, objectId, fetchStoryObjectAssets, fetchSceneAssets, fetchAssets]);

    // Auto-open generate panel when regenerating (initialGenerationSettings provided)
    useEffect(() => {
        if (initialGenerationSettings) {
            setShowGeneratePanel(true);
        }
    }, [initialGenerationSettings]);

    // Get linked assets with is_main info (for object mode)
    const linkedAssets = useMemo(() => {
        if (mode !== 'object' || !objectType || !objectId) return [];
        return getStoryObjectAssets(objectType, objectId);
    }, [mode, objectType, objectId, storyObjectAssets, getStoryObjectAssets]);

    // Unified asset list type for rendering
    type DisplayAsset = {
        id: string;
        asset: Asset | SceneAsset;
        is_main?: boolean;
        usage_count?: number;
        used_in_chapters?: Array<{ id: string; name: string; act_name?: string | null }>;
        // For object mode, keep reference to original link for unlink operation
        linkId?: string;
    };

    // Get display assets based on mode
    const displayAssets = useMemo((): DisplayAsset[] => {
        if (mode === 'object') {
            return linkedAssets.map(link => ({
                id: link.asset.id,
                linkId: link.id,
                asset: link.asset,
                is_main: link.is_main,
            }));
        } else if (mode === 'scene') {
            return sceneAssets.map(asset => ({
                id: asset.id,
                asset: asset,
                usage_count: asset.usage_count,
                used_in_chapters: asset.used_in_chapters,
            }));
        } else {
            // Picker mode: show all assets
            return assets.map(asset => ({
                id: asset.id,
                asset,
            }));
        }
    }, [mode, linkedAssets, sceneAssets, assets]);

    // Filter by search query
    const filteredAssets = useMemo(() => {
        if (!searchQuery) return displayAssets;
        return displayAssets.filter((item) =>
            item.asset.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [displayAssets, searchQuery]);

    // Dropdown file upload handler
    const handleDropdownFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || !currentProjectId) return;

        // Determine asset type based on mode
        const assetType = mode === 'scene' ? 'scene' : (mode === 'object' ? 'object' : undefined);

        for (const file of Array.from(files)) {
            try {
                const newAsset = await uploadAsset(currentProjectId, file, file.name, assetType);
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
                uploadAsset(currentProjectId, file, file.name, assetType).then((newAsset) => {
                    setSuccessModalAsset(newAsset);
                    setAssetName(file.name.replace(/\.[^/.]+$/, ''));
                    setShowImportDropdown(false);
                });
            }
        }
    }, [currentProjectId, uploadAsset, mode]);

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
            const target = e.target as HTMLElement;
            if (!target.closest('.asset-grid')) {
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
            ? `\n\nWarning: This image is used in ${sceneAsset.usage_count} chapter${sceneAsset.usage_count > 1 ? 's' : ''}:\n${sceneAsset.used_in_chapters.map(ch => `• ${ch.act_name ? ch.act_name + ' - ' : ''}${ch.name}`).join('\n')}`
            : '';

        if (window.confirm(`Are you sure you want to delete "${asset.name}"?${usageWarning}`)) {
            try {
                await deleteAsset(currentProjectId, asset.id);
                // Refresh the appropriate list
                if (mode === 'scene') {
                    await fetchSceneAssets(currentProjectId);
                } else if (mode === 'object' && objectType && objectId) {
                    await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
                } else {
                    await fetchAssets(currentProjectId);
                }
                onAssetChange?.();
                setDetailAsset(null);
                setMoreDropdownAssetId(null);
            } catch (err) {
                // Error handled in store
            }
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
                await fetchSceneAssets(currentProjectId);
            } else if (mode === 'object' && objectType && objectId) {
                await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
            } else {
                await fetchAssets(currentProjectId);
            }
        } catch (err) {
            // Error handled in store
        }
        setEditingAssetId(null);
    };

    // Common helper for linking asset and refreshing
    const linkAndRefreshAsset = async (asset: Asset) => {
        if (!currentProjectId) return;

        if (mode === 'object' && objectType && objectId) {
            const isFirstImage = linkedAssets.length === 0;
            await linkAssetToObject(currentProjectId, objectType, objectId, asset.id, isFirstImage);
            await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
        } else if (mode === 'scene') {
            await fetchSceneAssets(currentProjectId);
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
        setRegenerateSettings(null);

        try {
            await linkAndRefreshAsset(asset);
        } catch (err) {
            // Error handled in store
        }

        // Also notify parent if callback provided
        onImageGeneratedProp?.(asset);
    };

    const handleAssetClick = (item: DisplayAsset) => {
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

    const handleRegenerateWithSettings = (asset: AssetLike) => {
        if (!asset.generation_provider) return;

        const settings: RegenerateSettings = {
            provider: asset.generation_provider,
            model: asset.generation_model || '',
            prompt: asset.generation_prompt?.content || undefined,
            positive_prompt: asset.generation_positive_prompt?.content || undefined,
            negative_prompt: asset.generation_negative_prompt?.content || undefined,
            settings: asset.generation_settings as Record<string, unknown> | undefined,
        };

        if (asset.generation_settings?.size) {
            settings.size = String(asset.generation_settings.size);
        } else if (asset.width && asset.height) {
            settings.size = `${asset.width}x${asset.height}`;
        }

        setRegenerateSettings(settings);
        setDetailAsset(null);
        setShowImportDropdown(false);
        setShowGeneratePanel(true);
    };

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

            await linkAndRefreshAsset(successModalAsset);
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

                        <div className="asset-grid">
                            {filteredAssets.map((item) => {
                                const { rowSpan, colSpan } = calculateGridSpan(item.asset);
                                const isSelected = selectedAssetId === item.id;
                                const isExcluded = excludeAssetIds.includes(item.asset.id);
                                const isActive = activeAssetId === item.id;

                                return (
                                    <div
                                        key={item.id}
                                        className={`asset-item ${item.is_main ? 'main' : ''} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isExcluded ? 'excluded' : ''}`}
                                        style={{
                                            gridRow: `span ${rowSpan}`,
                                            gridColumn: `span ${colSpan}`,
                                        }}
                                        onClick={() => {
                                            if (isExcluded) return;

                                            if (mode === 'object') {
                                                // Object mode: first tap shows actions
                                                setActiveAssetId(item.id);
                                            } else {
                                                // Scene/Picker mode: tap to select + show actions
                                                handleAssetClick(item);
                                            }
                                        }}
                                    >
                                        {/* Star button - only in object mode */}
                                        {mode === 'object' && (
                                            <div className={`star-button-wrapper ${item.is_main ? 'is-main' : ''}`} onClick={(e) => e.stopPropagation()}>
                                                <IconButton
                                                    size="xs"
                                                    icon={<Star size="xs" />}
                                                    onClick={() => !item.is_main && handleSetMain(item.asset.id)}
                                                    title={item.is_main ? 'Main Image' : 'Set as Main'}
                                                    isActive={item.is_main}
                                                />
                                            </div>
                                        )}

                                        {/* Usage badge - only in scene mode */}
                                        {mode === 'scene' && item.usage_count && item.usage_count > 0 && (
                                            <div
                                                className="usage-badge"
                                                title={`Used in: ${item.used_in_chapters?.map(ch => ch.name).join(', ')}`}
                                            >
                                                {item.usage_count}
                                            </div>
                                        )}

                                        {/* Excluded overlay - only in picker mode */}
                                        {isExcluded && (
                                            <div className="excluded-overlay">
                                                <span>Selected</span>
                                            </div>
                                        )}

                                        <div className="asset-thumbnail">
                                            <img
                                                src={`${API_BASE_URL}${item.asset.thumbnail_url || item.asset.file_url}`}
                                                alt={item.asset.name}
                                                loading="lazy"
                                            />
                                        </div>

                                        <div className="asset-info">
                                            {editingAssetId === item.asset.id ? (
                                                <input
                                                    className="rename-input"
                                                    value={editingName}
                                                    onChange={(e) => setEditingName(e.target.value)}
                                                    onBlur={() => handleSaveRename(item.asset.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSaveRename(item.asset.id);
                                                        if (e.key === 'Escape') setEditingAssetId(null);
                                                    }}
                                                    autoFocus
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <>
                                                    <span className="asset-name" title={item.asset.name}>
                                                        {item.asset.name}
                                                    </span>
                                                    <button
                                                        className="rename-button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleStartRename(item.asset);
                                                        }}
                                                        title="Rename"
                                                    >
                                                        <Edit size="xs" />
                                                    </button>
                                                </>
                                            )}
                                        </div>

                                        {/* Action buttons */}
                                        <div className="asset-actions" onClick={(e) => e.stopPropagation()}>
                                            {/* More dropdown button */}
                                            <div className="more-dropdown-wrapper" ref={moreDropdownAssetId === item.id ? moreDropdownRef : undefined}>
                                                <IconButton
                                                    size="xs"
                                                    icon={<MoreHorizontal size="xs" />}
                                                    onClick={() => setMoreDropdownAssetId(moreDropdownAssetId === item.id ? null : item.id)}
                                                    title="More"
                                                />
                                                {moreDropdownAssetId === item.id && (
                                                    <div className="more-dropdown">
                                                        <button
                                                            className="more-dropdown-item"
                                                            onClick={() => handleOpenDetail(item.asset)}
                                                        >
                                                            <Info size="xs" />
                                                            <span>Detail</span>
                                                        </button>
                                                        <button
                                                            className="more-dropdown-item danger"
                                                            onClick={() => handleDeleteAsset(item.asset)}
                                                        >
                                                            <Trash size="xs" />
                                                            <span>Delete</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {filteredAssets.length === 0 && !isLoading && (
                                <div className="empty-state">
                                    {searchQuery
                                        ? 'No images match your search'
                                        : mode === 'scene'
                                            ? 'No scene images yet. Generate or upload scene images from the chapter editor.'
                                            : 'No images yet. Upload or generate one!'}
                                </div>
                            )}
                        </div>
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
                            <IconButton size="xs" icon={<Close size="sm" />} onClick={() => setSuccessModalAsset(null)} />
                        </div>
                        <div className="success-modal-body">
                            <div className="success-image-preview">
                                <img
                                    src={`${API_BASE_URL}${successModalAsset.thumbnail_url || successModalAsset.file_url}`}
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
                                Save & Link
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
                            <IconButton size="xs" icon={<Close size="sm" />} onClick={() => setDetailAsset(null)} />
                        </div>
                        <div className="asset-detail-body">
                            <div className="asset-detail-image">
                                <img
                                    src={`${API_BASE_URL}${detailAsset.file_url}`}
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
                            {detailAsset.generation_provider && (
                                <TextButton
                                    variant="secondary"
                                    onClick={() => handleRegenerateWithSettings(detailAsset)}
                                >
                                    Regenerate
                                </TextButton>
                            )}
                            <TextButton variant="secondary" onClick={() => setDetailAsset(null)}>
                                Close
                            </TextButton>
                        </div>
                    </div>
                </div>
            )}

            {/* Generate Panel (shown when Generate with AI is clicked) */}
            {showGeneratePanel && (
                <div className="generate-panel-overlay" onClick={() => setShowGeneratePanel(false)}>
                    <div className="generate-panel" onClick={(e) => e.stopPropagation()}>
                        <IconButton
                            className="generate-panel-close"
                            size="xs"
                            icon={<Close size="sm" />}
                            onClick={() => {
                                setShowGeneratePanel(false);
                                setRegenerateSettings(null);
                            }}
                        />
                        <ImageGenerationModal
                            onImageGenerated={handleImageGenerated}
                            onClose={() => {
                                setShowGeneratePanel(false);
                                setRegenerateSettings(null);
                            }}
                            objectType={objectType}
                            objectId={objectId}
                            initialSettings={regenerateSettings || (initialGenerationSettings && initialGenerationSettings.provider && initialGenerationSettings.model ? {
                                provider: initialGenerationSettings.provider,
                                model: initialGenerationSettings.model,
                                prompt: initialGenerationSettings.prompt,
                                positive_prompt: initialGenerationSettings.positivePrompt,
                                negative_prompt: initialGenerationSettings.negativePrompt,
                                size: initialGenerationSettings.size,
                                settings: initialGenerationSettings.settings,
                            } : null)}
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
