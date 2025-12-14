import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { DropdownMenu, DropdownItem, DropdownDivider } from './ui/DropdownMenu';
import ImageTabContent from './AssetManager/ImageTabContent';
import type { Asset } from '../api/assetService';
import { Sparkle, Scroll, Refresh, Trash } from './icons';
import './StoryCardInlineEdit.css';

type TabType = 'edit' | 'image';

interface StoryCardInlineEditProps {
    itemId: string;
    itemData: { name: string; description: string };
    effectiveLanguage: string;
    versionNumber: number;
    objectType: 'character' | 'organization' | 'location' | 'lorebook';
    mainAsset: Asset | null;
    loading?: boolean;
    showSecondaryLanguage?: boolean;
    onSave: (name: string, description: string) => void;
    onCancel: () => void;
    onAIEdit: () => void;
    onVersionHistory: () => void;
    onRetranslate: () => void;
    onDelete: () => void;
    onAssetChange?: () => void;
}

const StoryCardInlineEdit: React.FC<StoryCardInlineEditProps> = ({
    itemId,
    itemData,
    effectiveLanguage,
    versionNumber,
    objectType,
    loading = false,
    showSecondaryLanguage = false,
    onSave,
    onCancel,
    onAIEdit,
    onVersionHistory,
    onRetranslate,
    onDelete,
    onAssetChange,
}) => {
    const { currentProjectId } = useProjectStore();
    const [activeTab, setActiveTab] = useState<TabType>('edit');
    const [name, setName] = useState(itemData.name);
    const [description, setDescription] = useState(itemData.description);

    // Reset form when itemData changes
    useEffect(() => {
        setName(itemData.name);
        setDescription(itemData.description);
    }, [itemData.name, itemData.description]);

    const hasUnsavedChanges = name !== itemData.name || description !== itemData.description;

    const handleTabSwitch = (tab: TabType) => {
        if (hasUnsavedChanges && activeTab === 'edit' && tab !== 'edit') {
            if (!window.confirm('You have unsaved changes. Discard them?')) {
                return;
            }
            // Reset to original values
            setName(itemData.name);
            setDescription(itemData.description);
        }
        setActiveTab(tab);
    };

    const handleSave = () => {
        if (!name.trim()) {
            return;
        }
        onSave(name.trim(), description);
    };

    const handleCancel = () => {
        if (hasUnsavedChanges) {
            if (!window.confirm('Discard unsaved changes?')) {
                return;
            }
        }
        onCancel();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleCancel();
        }
    };

    return (
        <div className="story-card-inline-edit" onKeyDown={handleKeyDown}>
            {/* Tab navigation */}
            <div className="inline-edit-tabs">
                <button
                    className={`inline-edit-tab ${activeTab === 'edit' ? 'active' : ''}`}
                    onClick={() => handleTabSwitch('edit')}
                >
                    Edit
                </button>
                <button
                    className={`inline-edit-tab ${activeTab === 'image' ? 'active' : ''}`}
                    onClick={() => handleTabSwitch('image')}
                >
                    Image
                </button>
            </div>

            {/* Tab content */}
            <div className="inline-edit-content">
                {activeTab === 'edit' && (
                    <div className="edit-tab-content">
                        {/* Name field */}
                        <div className="edit-field">
                            <label htmlFor={`name-${itemId}`}>Name</label>
                            <input
                                id={`name-${itemId}`}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Enter name..."
                                className="edit-input"
                                autoFocus
                            />
                        </div>

                        {/* Description field */}
                        <div className="edit-field">
                            <label htmlFor={`desc-${itemId}`}>Description</label>
                            <textarea
                                id={`desc-${itemId}`}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Enter description..."
                                className="edit-textarea"
                                rows={4}
                            />
                        </div>

                        {/* Action row */}
                        <div className="edit-actions-row">
                            <button
                                className="ai-edit-button"
                                onClick={onAIEdit}
                                title="AI Edit"
                            >
                                <span className="ai-icon"><Sparkle size={14} /></span>
                                AI Edit
                            </button>

                            <DropdownMenu
                                trigger={
                                    <button className="more-actions-button" title="More actions">
                                        •••
                                    </button>
                                }
                                align="right"
                            >
                                <DropdownItem
                                    icon={<Scroll size={14} />}
                                    label="Version History"
                                    onClick={onVersionHistory}
                                />
                                {showSecondaryLanguage && (
                                    <DropdownItem
                                        icon={<Refresh size={14} />}
                                        label="Retranslate"
                                        onClick={onRetranslate}
                                    />
                                )}
                                <DropdownDivider />
                                <DropdownItem
                                    icon={<Trash size={14} />}
                                    label="Delete"
                                    onClick={onDelete}
                                    variant="danger"
                                />
                            </DropdownMenu>
                        </div>

                        {/* Metadata */}
                        <div className="edit-metadata">
                            <span className="metadata-item">
                                Language: {effectiveLanguage}
                            </span>
                            <span className="metadata-item">
                                Version: {versionNumber}
                            </span>
                        </div>

                        {/* Save/Cancel buttons */}
                        <div className="edit-buttons-row">
                            <button
                                className="cancel-button"
                                onClick={handleCancel}
                            >
                                Cancel
                            </button>
                            <button
                                className="save-button"
                                onClick={handleSave}
                                disabled={loading || !name.trim()}
                            >
                                {loading ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'image' && currentProjectId && (
                    <div className="image-tab-wrapper">
                        <ImageTabContent
                            objectType={objectType}
                            objectId={itemId}
                            onAssetChange={onAssetChange}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default StoryCardInlineEdit;
