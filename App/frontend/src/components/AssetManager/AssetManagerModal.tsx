import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useProjectStore } from '../../store/projectStore';
import { ImageGenerationPanel } from '../ImageGeneration';
import ImagePromptManager from './ImagePromptManager';
import type { Asset, StoryObjectAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import './AssetManagerModal.css';

type TabType = 'library' | 'upload' | 'generate' | 'prompt';

interface ChapterContext {
    chapterId: string;
    chapterName: string;
    chapterDescription: string;
    actId: string;
    selectedText: string | null;
    scenePreContext?: string;
    scenePostContext?: string;
}

interface AssetManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    objectType?: string;
    objectId?: string;
    title?: string;
    chapterContext?: ChapterContext;
    /** Optional callback for image picker mode. When provided, clicking an asset calls this instead of managing links. */
    onSelect?: (asset: Asset) => void;
}

const AssetManagerModal: React.FC<AssetManagerModalProps> = ({
    isOpen,
    onClose,
    objectType,
    objectId,
    title = 'Asset Manager',
    chapterContext,
    onSelect,
}) => {
    const { currentProjectId } = useProjectStore();
    const {
        assets,
        storyObjectAssets,
        isLoading,
        error,
        fetchAssets,
        fetchStoryObjectAssets,
        getStoryObjectAssets,
        uploadAsset,
        updateAsset,
        setMainAsset,
        unlinkAssetFromObject,
        linkAssetToObject,
        clearError,
    } = useAssetStore();

    const [activeTab, setActiveTab] = useState<TabType>('library');
    const [searchQuery, setSearchQuery] = useState('');
    const [successModalAsset, setSuccessModalAsset] = useState<Asset | null>(null);
    const [assetName, setAssetName] = useState('');
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Picker mode: onSelect provided, just browse all assets
    // Management mode: objectType + objectId provided, manage linked assets
    const isPickerMode = !!onSelect;
    const isManagementMode = !!objectType && !!objectId;

    useEffect(() => {
        if (isOpen && currentProjectId) {
            if (isPickerMode) {
                // Picker mode: fetch all project assets
                fetchAssets(currentProjectId);
            } else if (isManagementMode) {
                // Management mode: fetch assets linked to this object
                fetchStoryObjectAssets(currentProjectId, objectType, objectId);
            }
        }
    }, [isOpen, currentProjectId, objectType, objectId, isPickerMode, isManagementMode, fetchAssets, fetchStoryObjectAssets]);

    // Get linked assets with is_main info (management mode only)
    const linkedAssets = useMemo(() => {
        if (!isManagementMode) return [];
        return getStoryObjectAssets(objectType, objectId);
    }, [objectType, objectId, isManagementMode, storyObjectAssets, getStoryObjectAssets]);

    // Filter by search query
    const filteredAssets = useMemo(() => {
        if (isPickerMode) {
            // Picker mode: filter from all project assets
            const filtered = searchQuery
                ? assets.filter((asset) => asset.name.toLowerCase().includes(searchQuery.toLowerCase()))
                : assets;
            return filtered;
        } else {
            // Management mode: filter from linked assets
            if (!searchQuery) return linkedAssets;
            return linkedAssets.filter((link) =>
                link.asset.name.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }
    }, [isPickerMode, assets, linkedAssets, searchQuery]);

    if (!isOpen) return null;

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || !currentProjectId) return;

        for (const file of Array.from(files)) {
            try {
                const newAsset = await uploadAsset(currentProjectId, file, file.name);
                // Show success modal for last uploaded file
                setSuccessModalAsset(newAsset);
                setAssetName(file.name.replace(/\.[^/.]+$/, '')); // Remove extension
            } catch (err) {
                // Error handled in store
            }
        }

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSetMain = async (assetId: string) => {
        if (!currentProjectId || !objectType || !objectId) return;
        try {
            await setMainAsset(currentProjectId, objectType, objectId, assetId);
        } catch (err) {
            // Error handled in store
        }
    };

    const handleUnlink = async (link: StoryObjectAsset) => {
        if (!currentProjectId || !objectType || !objectId) return;

        if (window.confirm(`Remove "${link.asset.name}" from this ${objectType}?`)) {
            try {
                await unlinkAssetFromObject(currentProjectId, objectType, objectId, link.id);
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
            // Refresh to get updated asset name
            if (objectType && objectId) {
                await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
            }
        } catch (err) {
            // Error handled in store
        }
        setEditingAssetId(null);
    };

    const handleImageGenerated = (asset: Asset) => {
        // Show success modal with the generated asset
        setSuccessModalAsset(asset);
        setAssetName('Generated Image');
    };

    const handleSuccessModalSave = async () => {
        if (!successModalAsset || !currentProjectId) return;

        try {
            // Update asset name if changed
            if (assetName.trim() && assetName !== successModalAsset.name) {
                await updateAsset(currentProjectId, successModalAsset.id, assetName.trim());
            }

            // In picker mode, just select the asset
            if (isPickerMode) {
                onSelect?.(successModalAsset);
                setSuccessModalAsset(null);
                return;
            }

            // Auto-link to object (set as main if first image) - management mode only
            if (objectType && objectId) {
                const isFirstImage = linkedAssets.length === 0;
                await linkAssetToObject(currentProjectId, objectType, objectId, successModalAsset.id, isFirstImage);
                await fetchStoryObjectAssets(currentProjectId, objectType, objectId);
            }

            setSuccessModalAsset(null);
            setActiveTab('library');
        } catch (err) {
            // Error handled in store
        }
    };

    return (
        <div className="asset-modal-overlay" onClick={onClose}>
            <div className="asset-modal" onClick={(e) => e.stopPropagation()}>
                <div className="asset-modal-header">
                    <h2>{title}</h2>
                    <button className="close-button" onClick={onClose}>
                        &times;
                    </button>
                </div>

                <div className="asset-modal-tabs">
                    <button
                        className={`tab-button ${activeTab === 'library' ? 'active' : ''}`}
                        onClick={() => setActiveTab('library')}
                    >
                        Library
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'upload' ? 'active' : ''}`}
                        onClick={() => setActiveTab('upload')}
                    >
                        Upload
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'generate' ? 'active' : ''}`}
                        onClick={() => setActiveTab('generate')}
                    >
                        Generate
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'prompt' ? 'active' : ''}`}
                        onClick={() => setActiveTab('prompt')}
                    >
                        Prompt
                    </button>
                </div>

                <div className="asset-modal-content">
                    {activeTab === 'library' && (
                        <div className="library-tab">
                            <div className="search-bar">
                                <input
                                    type="text"
                                    placeholder="Search assets..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="search-input"
                                />
                            </div>

                            {isLoading && <div className="loading">Loading assets...</div>}

                            {error && (
                                <div className="error-banner">
                                    {error}
                                    <button onClick={clearError}>&times;</button>
                                </div>
                            )}

                            <div className="asset-grid">
                                {isPickerMode ? (
                                    // Picker mode: show all assets, click to select
                                    (filteredAssets as Asset[]).map((asset) => (
                                        <div
                                            key={asset.id}
                                            className="asset-item clickable"
                                            onClick={() => onSelect?.(asset)}
                                        >
                                            <div className="asset-thumbnail">
                                                <img
                                                    src={`${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`}
                                                    alt={asset.name}
                                                    loading="lazy"
                                                />
                                            </div>
                                            <div className="asset-info">
                                                <span className="asset-name" title={asset.name}>
                                                    {asset.name}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    // Management mode: show linked assets with actions
                                    (filteredAssets as StoryObjectAsset[]).map((link) => (
                                        <div
                                            key={link.id}
                                            className={`asset-item ${link.is_main ? 'main' : ''}`}
                                        >
                                            {link.is_main && <span className="main-badge">★</span>}
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
                                                            ✎
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
                                                    title="Remove from this object"
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}

                                {filteredAssets.length === 0 && !isLoading && (
                                    <div className="empty-state">
                                        {searchQuery
                                            ? 'No assets match your search'
                                            : 'No images yet. Upload or generate one!'}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'upload' && (
                        <div className="upload-tab">
                            <div className="upload-area">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleFileUpload}
                                    className="file-input"
                                    id="asset-file-input"
                                />
                                <label htmlFor="asset-file-input" className="upload-label">
                                    <div className="upload-icon">+</div>
                                    <span>Click to upload images</span>
                                    <span className="upload-hint">PNG, JPG, GIF, WebP</span>
                                </label>
                            </div>
                        </div>
                    )}

                    {activeTab === 'generate' && (
                        <div className="generate-tab">
                            <ImageGenerationPanel
                                onImageGenerated={handleImageGenerated}
                                chapterContext={chapterContext}
                                objectType={objectType}
                                objectId={objectId}
                            />
                        </div>
                    )}

                    {activeTab === 'prompt' && (
                        <div className="prompt-tab">
                            <ImagePromptManager
                                objectType={objectType}
                                objectId={objectId}
                            />
                        </div>
                    )}
                </div>

                <div className="asset-modal-footer">
                    <button className="cancel-button" onClick={onClose}>
                        Close
                    </button>
                </div>
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
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetManagerModal;
