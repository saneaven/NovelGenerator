import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useProjectStore } from '../../store/projectStore';
import { ImageGenerationPanel } from '../ImageGeneration';
import ImagePromptManager from './ImagePromptManager';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { formatStyledPrompt, type Asset, type StoryObjectAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import { Star, Edit, Folder, AIAssistMini, Close } from '../icons';
import './ImageTabContent.css';

// Calculate grid span based on image aspect ratio
function calculateGridSpan(asset: Asset | null, baseRowHeight: number = 10): { rowSpan: number; colSpan: number } {
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
    objectType: string;
    objectId: string;
    onAssetChange?: () => void;
}

const ImageTabContent: React.FC<ImageTabContentProps> = ({
    objectType,
    objectId,
    onAssetChange,
}) => {
    const { currentProjectId } = useProjectStore();
    const {
        storyObjectAssets,
        isLoading,
        error,
        fetchStoryObjectAssets,
        getStoryObjectAssets,
        uploadAsset,
        updateAsset,
        setMainAsset,
        unlinkAssetFromObject,
        linkAssetToObject,
        clearError,
    } = useAssetStore();

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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const importButtonRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (currentProjectId && objectType && objectId) {
            fetchStoryObjectAssets(currentProjectId, objectType, objectId);
        }
    }, [currentProjectId, objectType, objectId, fetchStoryObjectAssets]);

    // Get linked assets with is_main info
    const linkedAssets = useMemo(() => {
        return getStoryObjectAssets(objectType, objectId);
    }, [objectType, objectId, storyObjectAssets, getStoryObjectAssets]);

    // Filter by search query
    const filteredAssets = useMemo(() => {
        if (!searchQuery) return linkedAssets;
        return linkedAssets.filter((link) =>
            link.asset.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [linkedAssets, searchQuery]);

    // Dropdown file upload handler
    const handleDropdownFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || !currentProjectId) return;

        for (const file of Array.from(files)) {
            try {
                const newAsset = await uploadAsset(currentProjectId, file, file.name);
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
                uploadAsset(currentProjectId, file, file.name).then((newAsset) => {
                    setSuccessModalAsset(newAsset);
                    setAssetName(file.name.replace(/\.[^/.]+$/, ''));
                    setShowImportDropdown(false);
                });
            }
        }
    }, [currentProjectId, uploadAsset]);

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
            }
        };

        if (activeAssetId) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [activeAssetId]);

    const handleSetMain = async (assetId: string) => {
        if (!currentProjectId) return;
        try {
            await setMainAsset(currentProjectId, objectType, objectId, assetId);
            onAssetChange?.();
        } catch (err) {
            // Error handled in store
        }
    };

    const handleUnlink = async (link: StoryObjectAsset) => {
        if (!currentProjectId) return;

        if (window.confirm(`Remove "${link.asset.name}" from this ${objectType}?`)) {
            try {
                await unlinkAssetFromObject(currentProjectId, objectType, objectId, link.id);
                onAssetChange?.();
            } catch (err) {
                // Error handled in store
            }
        }
    };

    const handleStartRename = (asset: Asset) => {
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
            await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
        } catch (err) {
            // Error handled in store
        }
        setEditingAssetId(null);
    };

    const handleImageGenerated = (asset: Asset) => {
        setSuccessModalAsset(asset);
        setAssetName('Generated Image');
        setRegenerateSettings(null);
    };

    const handleAssetClick = (asset: Asset) => {
        setDetailAsset(asset);
    };

    const handleRegenerateWithSettings = (asset: Asset) => {
        if (!asset.generation_provider) return;

        const settings: RegenerateSettings = {
            provider: asset.generation_provider,
            model: asset.generation_model || '',
            prompt: asset.generation_prompt?.content || undefined,
            positive_prompt: asset.generation_positive_prompt?.content || undefined,
            negative_prompt: asset.generation_negative_prompt?.content || undefined,
            settings: asset.generation_settings || undefined,
        };

        if (asset.generation_settings?.size) {
            settings.size = asset.generation_settings.size;
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
            if (assetName.trim() && assetName !== successModalAsset.name) {
                await updateAsset(currentProjectId, successModalAsset.id, assetName.trim());
            }

            const isFirstImage = linkedAssets.length === 0;
            await linkAssetToObject(currentProjectId, objectType, objectId, successModalAsset.id, isFirstImage);
            await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
            onAssetChange?.();

            setSuccessModalAsset(null);
            setActiveSubTab('library');
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
                    <button
                        className={`subtab-button ${activeSubTab === 'prompt' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('prompt')}
                    >
                        Prompt
                    </button>
                </div>
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
                            {filteredAssets.map((link) => {
                                const { rowSpan, colSpan } = calculateGridSpan(link.asset);
                                return (
                                    <div
                                        key={link.id}
                                        className={`asset-item ${link.is_main ? 'main' : ''} ${activeAssetId === link.id ? 'active' : ''}`}
                                        style={{
                                            gridRow: `span ${rowSpan}`,
                                            gridColumn: `span ${colSpan}`,
                                        }}
                                        onClick={() => {
                                            // On mobile: first tap shows actions, second tap opens detail
                                            if (activeAssetId === link.id) {
                                                handleAssetClick(link.asset);
                                            } else {
                                                setActiveAssetId(link.id);
                                            }
                                        }}
                                    >
                                        <div className={`star-button-wrapper ${link.is_main ? 'is-main' : ''}`} onClick={(e) => e.stopPropagation()}>
                                            <IconButton
                                                size="xs"
                                                icon={<Star size="xs" />}
                                                onClick={() => !link.is_main && handleSetMain(link.asset.id)}
                                                title={link.is_main ? 'Main Image' : 'Set as Main'}
                                                isActive={link.is_main}
                                            />
                                        </div>
                                        <div className="asset-thumbnail">
                                            <img
                                                src={`${API_BASE_URL}${link.asset.thumbnail_url || link.asset.file_url}`}
                                                alt={link.asset.name}
                                                loading="lazy"
                                            />
                                        </div>
                                        <div className="asset-info">
                                            {editingAssetId === link.asset.id ? (
                                                <input
                                                    className="rename-input"
                                                    value={editingName}
                                                    onChange={(e) => setEditingName(e.target.value)}
                                                    onBlur={() => handleSaveRename(link.asset.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSaveRename(link.asset.id);
                                                        if (e.key === 'Escape') setEditingAssetId(null);
                                                    }}
                                                    autoFocus
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <>
                                                    <span className="asset-name" title={link.asset.name}>
                                                        {link.asset.name}
                                                    </span>
                                                    <button
                                                        className="rename-button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleStartRename(link.asset);
                                                        }}
                                                        title="Rename"
                                                    >
                                                        <Edit size="xs" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        <div className="asset-actions">
                                            <div onClick={(e) => e.stopPropagation()}>
                                                <IconButton
                                                    size="xs"
                                                    icon={<Close size="xs" />}
                                                    onClick={() => handleUnlink(link)}
                                                    title="Remove"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {filteredAssets.length === 0 && !isLoading && (
                                <div className="empty-state">
                                    {searchQuery
                                        ? 'No images match your search'
                                        : 'No images yet. Upload or generate one!'}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeSubTab === 'prompt' && (
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
                        <ImageGenerationPanel
                            onImageGenerated={handleImageGenerated}
                            objectType={objectType}
                            objectId={objectId}
                            initialSettings={regenerateSettings}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImageTabContent;
