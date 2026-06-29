import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useSelectionStore } from '../../../store/selectionStore';
import { DropdownMenu, DropdownItem, DropdownSection } from '../../ui/DropdownMenu';
import { AIAssistMini, Scroll, Refresh, Trash, Collapse, MoreHorizontal, Save, Plus } from '../../icons';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import ImageTabContent from '../../AssetManager/ImageTabContent';
import { RichTextEditor, type RichTextEditorRef } from '../../RichTextEditor';
import AuthenticatedImage from '../../common/AuthenticatedImage';
import type { Asset } from '../../../api/assetService';
import type { TipTapDoc } from '../../../types/tiptap';
import { normalizeDoc } from '../../../editor/richtext/doc';
import { getAssetUrl } from '../../../utils/assetUrl';
import { confirm } from '../../../store/dialogStore';
import './ObjectCardExpanded.css';

type TabType = 'edit' | 'details' | 'content' | 'image';

const isEditTab = (tab: TabType) => tab === 'edit' || tab === 'details' || tab === 'content';

interface ObjectCardExpandedProps {
    itemId: string;
    itemData: { name: string; description: string; content: TipTapDoc };
    effectiveLanguage: string;
    versionNumber: number;
    reloadKey?: string;
    objectType: 'character' | 'organization' | 'location' | 'lorebook' | 'story_entity' | 'outline' | 'act' | 'chapter';
    mainAsset: Asset | null;
    loading?: boolean;
    isNewItem?: boolean;
    readOnly?: boolean;
    readOnlyReason?: string;
    primaryActionLabel?: string;
    saveLabel?: string;
    hideAIEdit?: boolean;
    hideImageTab?: boolean;
    extraEditFields?: React.ReactNode;
    onSave: (name: string, description: string, content: TipTapDoc) => void;
    onCancel: () => void;
    onPrimaryAction?: () => void;
    onAIEdit?: () => void;
    onVersionHistory?: () => void;
    onRetranslate?: () => void;
    onDelete?: () => void;
    onAssetChange?: () => void;
}

const ObjectCardExpanded: React.FC<ObjectCardExpandedProps> = ({
    itemId,
    itemData,
    effectiveLanguage,
    versionNumber,
    reloadKey,
    objectType,
    mainAsset,
    loading = false,
    isNewItem = false,
    readOnly = false,
    readOnlyReason,
    primaryActionLabel,
    saveLabel,
    hideAIEdit = false,
    hideImageTab = false,
    extraEditFields,
    onSave,
    onCancel,
    onPrimaryAction,
    onAIEdit,
    onVersionHistory,
    onRetranslate,
    onDelete,
    onAssetChange,
}) => {
    const { currentProjectId } = useSelectionStore();
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
    );
    const [activeTab, setActiveTab] = useState<TabType>('edit');
    const [name, setName] = useState(itemData.name);
    const [description, setDescription] = useState(itemData.description);
    const [content, setContent] = useState<TipTapDoc>(normalizeDoc(itemData.content));
    const editorRef = useRef<RichTextEditorRef>(null);

    // Track viewport so the Edit tab can split into Details/Content on mobile
    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const mql = window.matchMedia('(max-width: 768px)');
        const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        setIsMobile(mql.matches);
        mql.addEventListener('change', handleChange);
        return () => mql.removeEventListener('change', handleChange);
    }, []);

    // Keep activeTab valid as the viewport crosses the mobile breakpoint
    useEffect(() => {
        if (isMobile) {
            setActiveTab((prev) => (prev === 'edit' ? 'details' : prev));
        } else {
            setActiveTab((prev) => (prev === 'details' || prev === 'content' ? 'edit' : prev));
        }
    }, [isMobile]);

    // Reset form when itemData changes
    useEffect(() => {
        setName(itemData.name);
        setDescription(itemData.description);
        setContent(normalizeDoc(itemData.content));
    }, [itemData.name, itemData.description, itemData.content]);

    // Use editorRef.hasChanges() for content comparison (handles TipTap normalization)
    const hasUnsavedChanges = !readOnly && (
        name !== itemData.name
        || description !== itemData.description
        || (editorRef.current?.hasChanges() ?? false)
    );
    const hasImage = Boolean(mainAsset);

    const handleTabSwitch = async (tab: TabType) => {
        if (hasUnsavedChanges && isEditTab(activeTab) && !isEditTab(tab)) {
            const confirmed = await confirm({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes. Discard them?',
                variant: 'warning',
                confirmLabel: 'Discard',
            });
            if (!confirmed) {
                return;
            }
            setName(itemData.name);
            setDescription(itemData.description);
            setContent(normalizeDoc(itemData.content));
        }
        setActiveTab(tab);
    };

    const handleSave = () => {
        if (!name.trim()) {
            return;
        }
        if (readOnly) {
            return;
        }
        onSave(name.trim(), description, normalizeDoc(editorRef.current?.getDoc() ?? content));
    };

    const handleCancel = async () => {
        if (hasUnsavedChanges) {
            const confirmed = await confirm({
                title: 'Unsaved Changes',
                message: 'Discard unsaved changes?',
                variant: 'warning',
                confirmLabel: 'Discard',
            });
            if (!confirmed) {
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
            className={`object-card-expanded ${hasImage ? 'has-image' : 'no-image'}`}
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
                    {isMobile ? (
                        <>
                            <button
                                className={`expanded-tab ${activeTab === 'details' ? 'active' : ''}`}
                                onClick={() => handleTabSwitch('details')}
                            >
                                Details
                            </button>
                            <button
                                className={`expanded-tab ${activeTab === 'content' ? 'active' : ''}`}
                                onClick={() => handleTabSwitch('content')}
                            >
                                Content
                            </button>
                        </>
                    ) : (
                        <button
                            className={`expanded-tab ${activeTab === 'edit' ? 'active' : ''}`}
                            onClick={() => handleTabSwitch('edit')}
                        >
                            Edit
                        </button>
                    )}
                    {!hideImageTab && (
                        <button
                            className={`expanded-tab ${activeTab === 'image' ? 'active' : ''}`}
                            onClick={() => handleTabSwitch('image')}
                            disabled={isNewItem}
                        >
                            Image
                        </button>
                    )}
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
                    {isEditTab(activeTab) && (
                        <div className="expanded-edit-content">
                            {/* Details section: kind, parent folder, name, summary */}
                            <div
                                className={`expanded-section-details ${isMobile && activeTab !== 'details' ? 'expanded-section-hidden' : ''}`}
                            >
                                {extraEditFields}

                                {readOnlyReason && (
                                    <p className="expanded-readonly-reason">{readOnlyReason}</p>
                                )}

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
                                        disabled={readOnly}
                                    />
                                </div>

                                {/* Description field - One-line summary (textarea on mobile) */}
                                <div className="expanded-field expanded-field-summary">
                                    <label htmlFor={`expanded-description-${itemId}`}>Summary</label>
                                    {isMobile ? (
                                        <textarea
                                            id={`expanded-description-${itemId}`}
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder="One-line summary..."
                                            className="expanded-input expanded-textarea-description"
                                            maxLength={500}
                                            rows={3}
                                            disabled={readOnly}
                                        />
                                    ) : (
                                        <input
                                            id={`expanded-description-${itemId}`}
                                            type="text"
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder="One-line summary..."
                                            className="expanded-input expanded-input-description"
                                            maxLength={500}
                                            disabled={readOnly}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Content field - Rich Text Editor */}
                            <div
                                className={`expanded-field expanded-field-grow ${isMobile && activeTab !== 'content' ? 'expanded-section-hidden' : ''}`}
                            >
                                <label>Content</label>
                                <RichTextEditor
                                    ref={editorRef}
                                    key={reloadKey ?? itemId}
                                    initialContent={normalizeDoc(itemData.content)}
                                    onChange={setContent}
                                    placeholder="Enter content..."
                                    disabled={readOnly}
                                />
                            </div>

                            {/* Actions row */}
                            <div className="expanded-actions-row">
                                {!isNewItem && (
                                    <DropdownMenu
                                        trigger={
                                            <IconButton
                                                icon={<MoreHorizontal size="sm" />}
                                                title="More actions"
                                                size="sm"
                                            />
                                        }
                                        align="left"
                                    >
                                        <DropdownSection>
                                            <DropdownItem
                                                icon={<Scroll size="sm" />}
                                                label="Version History"
                                                onClick={onVersionHistory}
                                            />
                                            {onRetranslate && (
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
                                )}

                                {!isNewItem && onAIEdit && !hideAIEdit && !readOnly && (
                                    <TextButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={onAIEdit}
                                        title="AI Edit"
                                        iconLeft={<AIAssistMini size="sm" />}
                                    >
                                        AI Edit
                                    </TextButton>
                                )}

                                {!isNewItem && (
                                    <div className="expanded-metadata">
                                        <span className="metadata-item">
                                            Language: {effectiveLanguage}
                                        </span>
                                        <span className="metadata-item">
                                            Version: {versionNumber}
                                        </span>
                                    </div>
                                )}

                                {readOnly ? (
                                    primaryActionLabel && onPrimaryAction ? (
                                        <TextButton
                                            variant="primary"
                                            size="sm"
                                            onClick={onPrimaryAction}
                                        >
                                            {primaryActionLabel}
                                        </TextButton>
                                    ) : null
                                ) : (
                                    <TextButton
                                        variant="primary"
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={loading || !name.trim()}
                                        loading={loading}
                                        iconLeft={isNewItem ? <Plus size="sm" /> : <Save size="sm" />}
                                    >
                                        {isNewItem ? 'Create' : (saveLabel || 'Save')}
                                    </TextButton>
                                )}
                            </div>
                        </div>
                    )}

                    {!hideImageTab && activeTab === 'image' && currentProjectId && (
                        <div className="expanded-image-tab">
                            <ImageTabContent
                                mode="object"
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
                    <AuthenticatedImage
                        src={getAssetUrl(mainAsset) || ''}
                        alt={itemData.name}
                        className="expanded-image"
                    />
                </div>
            )}
        </motion.article>
    );
};

export default ObjectCardExpanded;
