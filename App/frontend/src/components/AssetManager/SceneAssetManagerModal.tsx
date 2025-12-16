import React, { useState, useEffect, useMemo } from 'react';
import { BaseModal } from '../BaseModal';
import { useAssetStore } from '../../store/assetStore';
import { useProjectStore } from '../../store/projectStore';
import { TextButton } from '../TextButton';
import { formatStyledPrompt, type SceneAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import { Edit } from '../icons';
import './SceneAssetManagerModal.css';

interface SceneAssetManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SceneAssetManagerModal: React.FC<SceneAssetManagerModalProps> = ({
    isOpen,
    onClose,
}) => {
    const { currentProjectId } = useProjectStore();
    const {
        sceneAssets,
        isLoading,
        error,
        fetchSceneAssets,
        updateAsset,
        deleteAsset,
        clearError,
    } = useAssetStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [detailAsset, setDetailAsset] = useState<SceneAsset | null>(null);
    const [deleteConfirmAsset, setDeleteConfirmAsset] = useState<SceneAsset | null>(null);

    useEffect(() => {
        if (isOpen && currentProjectId) {
            fetchSceneAssets(currentProjectId);
        }
    }, [isOpen, currentProjectId, fetchSceneAssets]);

    // Filter by search query
    const filteredAssets = useMemo(() => {
        if (!searchQuery) return sceneAssets;
        return sceneAssets.filter((asset) =>
            asset.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [sceneAssets, searchQuery]);

    if (!isOpen) return null;

    const handleStartRename = (asset: SceneAsset, e: React.MouseEvent) => {
        e.stopPropagation();
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
            await fetchSceneAssets(currentProjectId);
        } catch (err) {
            // Error handled in store
        }
        setEditingAssetId(null);
    };

    const handleDeleteClick = (asset: SceneAsset, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirmAsset(asset);
    };

    const handleConfirmDelete = async () => {
        if (!currentProjectId || !deleteConfirmAsset) return;
        try {
            await deleteAsset(currentProjectId, deleteConfirmAsset.id);
            await fetchSceneAssets(currentProjectId);
            setDeleteConfirmAsset(null);
        } catch (err) {
            // Error handled in store
        }
    };

    const handleAssetClick = (asset: SceneAsset) => {
        setDetailAsset(asset);
    };

    // Format file size for display
    const formatFileSize = (bytes: number | null): string => {
        if (!bytes) return 'Unknown';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Format date for display
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

    // Get provider display name
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

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                size="large"
                title="Scene Asset Library"
                className="scene-asset-modal"
                footer={
                    <TextButton variant="secondary" onClick={onClose}>
                        Close
                    </TextButton>
                }
            >
                <div className="scene-asset-modal-content">
                    <div className="scene-library-tab">
                        <div className="search-bar">
                            <input
                                type="text"
                                placeholder="Search scene assets..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="search-input"
                            />
                        </div>

                        {isLoading && <div className="loading">Loading scene assets...</div>}

                        {error && (
                            <div className="error-banner">
                                {error}
                                <button onClick={clearError}>&times;</button>
                            </div>
                        )}

                        <div className="scene-asset-grid">
                            {filteredAssets.map((asset) => (
                                <div
                                    key={asset.id}
                                    className="scene-asset-item"
                                    onClick={() => handleAssetClick(asset)}
                                >
                                    {/* Chapter usage badge */}
                                    {asset.usage_count > 0 && (
                                        <div
                                            className="usage-badge"
                                            title={`Used in: ${asset.used_in_chapters.map(ch => ch.name).join(', ')}`}
                                        >
                                            {asset.usage_count}
                                        </div>
                                    )}

                                    <div className="scene-asset-thumbnail">
                                        <img
                                            src={`${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`}
                                            alt={asset.name}
                                            loading="lazy"
                                        />
                                    </div>

                                    <div className="scene-asset-info">
                                        {editingAssetId === asset.id ? (
                                            <input
                                                className="rename-input"
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onBlur={() => handleSaveRename(asset.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveRename(asset.id);
                                                    if (e.key === 'Escape') setEditingAssetId(null);
                                                }}
                                                autoFocus
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        ) : (
                                            <>
                                                <span className="scene-asset-name" title={asset.name}>
                                                    {asset.name}
                                                </span>
                                                <div className="scene-asset-actions">
                                                    <button
                                                        className="rename-button"
                                                        onClick={(e) => handleStartRename(asset, e)}
                                                        title="Rename"
                                                    >
                                                        <Edit size="xs" />
                                                    </button>
                                                    <button
                                                        className="delete-button"
                                                        onClick={(e) => handleDeleteClick(asset, e)}
                                                        title="Delete"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {filteredAssets.length === 0 && !isLoading && (
                                <div className="empty-state">
                                    {searchQuery
                                        ? 'No scene assets match your search'
                                        : 'No scene assets yet. Generate or upload scene images from the chapter editor.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </BaseModal>

            {/* Delete Confirmation Modal */}
            {deleteConfirmAsset && (
                <div className="delete-confirm-overlay" onClick={() => setDeleteConfirmAsset(null)}>
                    <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="delete-confirm-header">
                            <h3>Delete Scene Asset</h3>
                            <button className="close-button" onClick={() => setDeleteConfirmAsset(null)}>
                                &times;
                            </button>
                        </div>
                        <div className="delete-confirm-body">
                            <div className="delete-preview">
                                <img
                                    src={`${API_BASE_URL}${deleteConfirmAsset.thumbnail_url || deleteConfirmAsset.file_url}`}
                                    alt={deleteConfirmAsset.name}
                                />
                            </div>
                            <p>
                                Are you sure you want to delete <strong>{deleteConfirmAsset.name}</strong>?
                            </p>
                            {deleteConfirmAsset.usage_count > 0 && (
                                <div className="delete-warning">
                                    <strong>Warning:</strong> This image is used in {deleteConfirmAsset.usage_count} chapter{deleteConfirmAsset.usage_count > 1 ? 's' : ''}:
                                    <ul>
                                        {deleteConfirmAsset.used_in_chapters.map((ch) => (
                                            <li key={ch.id}>
                                                {ch.act_name ? `${ch.act_name} - ` : ''}{ch.name}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="delete-confirm-footer">
                            <TextButton variant="secondary" onClick={() => setDeleteConfirmAsset(null)}>
                                Cancel
                            </TextButton>
                            <TextButton variant="danger" onClick={handleConfirmDelete}>
                                Delete
                            </TextButton>
                        </div>
                    </div>
                </div>
            )}

            {/* Asset Detail Modal */}
            {detailAsset && (
                <div className="scene-detail-overlay" onClick={() => setDetailAsset(null)}>
                    <div className="scene-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="scene-detail-header">
                            <h3>Scene Asset Details</h3>
                            <button className="close-button" onClick={() => setDetailAsset(null)}>
                                &times;
                            </button>
                        </div>
                        <div className="scene-detail-body">
                            <div className="scene-detail-image">
                                <img
                                    src={`${API_BASE_URL}${detailAsset.file_url}`}
                                    alt={detailAsset.name}
                                />
                            </div>
                            <div className="scene-detail-info">
                                <div className="scene-detail-section">
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

                                {/* Chapter Usage Section */}
                                {detailAsset.usage_count > 0 && (
                                    <div className="scene-detail-section">
                                        <h4>Used In Chapters ({detailAsset.usage_count})</h4>
                                        <ul className="chapter-usage-list">
                                            {detailAsset.used_in_chapters.map((ch) => (
                                                <li key={ch.id}>
                                                    {ch.act_name ? `${ch.act_name} - ` : ''}{ch.name}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Generation Info - only show if image was generated */}
                                {detailAsset.generation_provider && (
                                    <div className="scene-detail-section">
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

                                        {/* Natural language prompt */}
                                        {detailAsset.generation_prompt && (
                                            <div className="detail-row vertical">
                                                <span className="detail-label">Prompt</span>
                                                <div className="detail-prompt-box">
                                                    {formatStyledPrompt(detailAsset.generation_prompt)}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tag-based prompts (NovelAI) */}
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
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="scene-detail-footer">
                            <TextButton variant="secondary" onClick={() => setDetailAsset(null)}>
                                Close
                            </TextButton>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default SceneAssetManagerModal;
