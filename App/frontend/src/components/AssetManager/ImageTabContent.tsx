import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useProjectStore } from '../../store/projectStore';
import { ImageGenerationPanel } from '../ImageGeneration';
import ImagePromptManager from './ImagePromptManager';
import { formatStyledPrompt, type Asset, type StoryObjectAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import { Star, Edit } from '../icons';
import './ImageTabContent.css';

type SubTabType = 'library' | 'upload' | 'generate' | 'prompt';

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
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || !currentProjectId) return;

        for (const file of Array.from(files)) {
            try {
                const newAsset = await uploadAsset(currentProjectId, file, file.name);
                setSuccessModalAsset(newAsset);
                setAssetName(file.name.replace(/\.[^/.]+$/, ''));
            } catch (err) {
                // Error handled in store
            }
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

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
        setActiveSubTab('generate');
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
            {/* Sub-tabs */}
            <div className="image-tab-subtabs">
                <button
                    className={`subtab-button ${activeSubTab === 'library' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('library')}
                >
                    Library
                </button>
                <button
                    className={`subtab-button ${activeSubTab === 'upload' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('upload')}
                >
                    Upload
                </button>
                <button
                    className={`subtab-button ${activeSubTab === 'generate' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('generate')}
                >
                    Generate
                </button>
                <button
                    className={`subtab-button ${activeSubTab === 'prompt' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('prompt')}
                >
                    Prompt
                </button>
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
                            {filteredAssets.map((link) => (
                                <div
                                    key={link.id}
                                    className={`asset-item ${link.is_main ? 'main' : ''}`}
                                    onClick={() => handleAssetClick(link.asset)}
                                >
                                    {link.is_main && <span className="main-badge"><Star size="xs" /></span>}
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
                                        {!link.is_main && (
                                            <button
                                                className="set-main-button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSetMain(link.asset.id);
                                                }}
                                            >
                                                Set as Main
                                            </button>
                                        )}
                                        {link.is_main && (
                                            <span className="main-label">Main Image</span>
                                        )}
                                        <button
                                            className="delete-button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleUnlink(link);
                                            }}
                                            title="Remove"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                </div>
                            ))}

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

                {activeSubTab === 'upload' && (
                    <div className="upload-subtab">
                        <div className="upload-area">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleFileUpload}
                                className="file-input"
                                id="image-tab-file-input"
                            />
                            <label htmlFor="image-tab-file-input" className="upload-label">
                                <div className="upload-icon">+</div>
                                <span>Click to upload images</span>
                                <span className="upload-hint">PNG, JPG, GIF, WebP</span>
                            </label>
                        </div>
                    </div>
                )}

                {activeSubTab === 'generate' && (
                    <div className="generate-subtab">
                        <ImageGenerationPanel
                            onImageGenerated={handleImageGenerated}
                            objectType={objectType}
                            objectId={objectId}
                            initialSettings={regenerateSettings}
                        />
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
                            <button className="close-button" onClick={() => setSuccessModalAsset(null)}>
                                &times;
                            </button>
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
                            <button className="cancel-button" onClick={() => setSuccessModalAsset(null)}>
                                Cancel
                            </button>
                            <button className="save-button" onClick={handleSuccessModalSave}>
                                Save & Link
                            </button>
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
                            <button className="close-button" onClick={() => setDetailAsset(null)}>
                                &times;
                            </button>
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
                                <button
                                    className="regenerate-button"
                                    onClick={() => handleRegenerateWithSettings(detailAsset)}
                                >
                                    Regenerate
                                </button>
                            )}
                            <button className="cancel-button" onClick={() => setDetailAsset(null)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImageTabContent;
