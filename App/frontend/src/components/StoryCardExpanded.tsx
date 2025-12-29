import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useProjectStore } from '../store/projectStore';
import { DropdownMenu, DropdownItem, DropdownSection } from './ui/DropdownMenu';
import { AIAssistMini, Scroll, Refresh, Trash, Collapse, MoreHorizontal, Save } from './icons';
import { IconButton } from './IconButton';
import { TextButton } from './TextButton';
import ImageTabContent from './AssetManager/ImageTabContent';
import type { Asset } from '../api/assetService';
import { API_BASE_URL } from '../api/client';
import './StoryCardExpanded.css';

type TabType = 'edit' | 'image';

interface StoryCardExpandedProps {
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

const StoryCardExpanded: React.FC<StoryCardExpandedProps> = ({
    itemId,
    itemData,
    effectiveLanguage,
    versionNumber,
    objectType,
    mainAsset,
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
    const hasImage = Boolean(mainAsset);

    const handleTabSwitch = (tab: TabType) => {
        if (hasUnsavedChanges && activeTab === 'edit' && tab !== 'edit') {
            if (!window.confirm('You have unsaved changes. Discard them?')) {
                return;
            }
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
        <motion.article
            layoutId={`card-${itemId}`}
            className={`story-card-expanded ${hasImage ? 'has-image' : 'no-image'}`}
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
                layout: { type: 'spring', stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
            }}
        >
            {/* Content section */}
            <div className="expanded-content-section">
                {/* Tab navigation */}
                <div className="expanded-tabs">
                    <button
                        className={`expanded-tab ${activeTab === 'edit' ? 'active' : ''}`}
                        onClick={() => handleTabSwitch('edit')}
                    >
                        Edit
                    </button>
                    <button
                        className={`expanded-tab ${activeTab === 'image' ? 'active' : ''}`}
                        onClick={() => handleTabSwitch('image')}
                    >
                        Image
                    </button>
                    <IconButton
                        icon={<Collapse size="md" />}
                        onClick={handleCancel}
                        ariaLabel="Close"
                        title="Close"
                        size="sm"
                        variant="ghost"
                        className="expanded-close-btn"
                    />
                </div>

                {/* Tab content */}
                <div className="expanded-tab-content">
                    {activeTab === 'edit' && (
                        <div className="expanded-edit-content">
                            {/* Name field */}
                            <div className="expanded-field">
                                <label htmlFor={`expanded-name-${itemId}`}>Name</label>
                                <input
                                    id={`expanded-name-${itemId}`}
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Enter name..."
                                    className="expanded-input expanded-input-name"
                                />
                            </div>

                            {/* Description field */}
                            <div className="expanded-field expanded-field-grow">
                                <label htmlFor={`expanded-desc-${itemId}`}>Description</label>
                                <textarea
                                    id={`expanded-desc-${itemId}`}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Enter description..."
                                    className="expanded-textarea"
                                />
                            </div>

                            {/* Actions row */}
                            <div className="expanded-actions-row">
                                <DropdownMenu
                                    trigger={
                                        <IconButton
                                            icon={<MoreHorizontal size="sm" />}
                                            title="More actions"
                                            size="sm"
                                        />
                                    }
                                    align="right"
                                >
                                    <DropdownSection>
                                        <DropdownItem
                                            icon={<Scroll size="sm" />}
                                            label="Version History"
                                            onClick={onVersionHistory}
                                        />
                                        {showSecondaryLanguage && (
                                            <DropdownItem
                                                icon={<Refresh size="sm" />}
                                                label="Retranslate"
                                                onClick={onRetranslate}
                                            />
                                        )}
                                    </DropdownSection>
                                    <DropdownSection>
                                        <DropdownItem
                                            icon={<Trash size="sm" />}
                                            label="Delete"
                                            onClick={onDelete}
                                            variant="danger"
                                        />
                                    </DropdownSection>
                                </DropdownMenu>

                                <TextButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={onAIEdit}
                                    title="AI Edit"
                                    iconLeft={<AIAssistMini size="sm" />}
                                >
                                    AI Edit
                                </TextButton>

                                <div className="expanded-metadata">
                                    <span className="metadata-item">
                                        Language: {effectiveLanguage}
                                    </span>
                                    <span className="metadata-item">
                                        Version: {versionNumber}
                                    </span>
                                </div>

                                <TextButton
                                    variant="primary"
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={loading || !name.trim()}
                                    loading={loading}
                                    iconLeft={<Save size="sm" />}
                                >
                                    Save
                                </TextButton>
                            </div>
                        </div>
                    )}

                    {activeTab === 'image' && currentProjectId && (
                        <div className="expanded-image-tab">
                            <ImageTabContent
                                objectType={objectType}
                                objectId={itemId}
                                onAssetChange={onAssetChange}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Image section - plain div (no layoutId to avoid Framer Motion interference) */}
            {hasImage && mainAsset && (
                <div className="expanded-image-section">
                    <img
                        src={`${API_BASE_URL}${mainAsset.file_url}`}
                        alt={itemData.name}
                        className="expanded-image"
                    />
                </div>
            )}
        </motion.article>
    );
};

export default StoryCardExpanded;
