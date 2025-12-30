import React, { useState } from 'react';
import { BaseModal } from '../BaseModal';
import ImageTabContent, { type ImageContentMode } from './ImageTabContent';
import { TextButton } from '../TextButton';
import { type Asset } from '../../api/assetService';
import './UnifiedImageModal.css';

// Modal preset types for common use cases
export type ModalPreset =
    | 'objectManager'   // Manage story object images (link/unlink, set main)
    | 'sceneManager'    // Manage scene assets (delete, view usage)
    | 'assetPicker'     // Pick from all project assets
    | 'referencePicker'; // Pick reference images for image generation

// Initial settings for regeneration mode
export interface InitialGenerationSettings {
    prompt?: string;
    positivePrompt?: string;
    negativePrompt?: string;
    provider?: string;
    model?: string;
    size?: string;
    settings?: Record<string, any>;
}

interface UnifiedImageModalProps {
    isOpen: boolean;
    onClose: () => void;

    // Use preset for common configurations
    preset?: ModalPreset;

    // Or configure manually
    mode?: ImageContentMode;

    // Common props
    title?: string;
    size?: 'small' | 'medium' | 'large';
    zIndexLayer?: number;

    // Object management props
    objectType?: string;
    objectId?: string;
    onAssetChange?: () => void;

    // Scene mode props
    manuscriptId?: string;  // For scene mode: ownership filtering

    // Picker props
    onSelect?: (asset: Asset) => void;
    excludeAssetIds?: string[];

    // Scene context for AI assist
    sceneContext?: { preContext: string; postContext: string };

    // Image generation callback
    onImageGenerated?: (asset: Asset) => void;
    initialGenerationSettings?: InitialGenerationSettings;
}

// Preset configurations
const PRESET_CONFIGS: Record<ModalPreset, {
    mode: ImageContentMode;
    title: string;
    size: 'small' | 'medium' | 'large';
}> = {
    objectManager: {
        mode: 'object',
        title: 'Manage Images',
        size: 'large',
    },
    sceneManager: {
        mode: 'scene',
        title: 'Scene Asset Library',
        size: 'large',
    },
    assetPicker: {
        mode: 'picker',
        title: 'Select Image',
        size: 'large',
    },
    referencePicker: {
        mode: 'picker',
        title: 'Select Reference Image',
        size: 'large',
    },
};

const UnifiedImageModal: React.FC<UnifiedImageModalProps> = ({
    isOpen,
    onClose,
    preset,
    mode: modeProp,
    title: titleProp,
    size: sizeProp,
    zIndexLayer,
    objectType,
    objectId,
    onAssetChange,
    manuscriptId,
    onSelect,
    excludeAssetIds,
    sceneContext,
    onImageGenerated,
    initialGenerationSettings,
}) => {
    // Get config from preset or use direct props
    const presetConfig = preset ? PRESET_CONFIGS[preset] : null;
    const mode = modeProp ?? presetConfig?.mode ?? 'object';
    const title = titleProp ?? presetConfig?.title ?? 'Images';
    const size = sizeProp ?? presetConfig?.size ?? 'large';

    // Track selected asset for footer button
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

    // Handle selection change from ImageTabContent
    const handleSelectionChange = (asset: Asset | null) => {
        setSelectedAsset(asset);
    };

    // Handle confirm selection from footer button
    const handleConfirmSelect = () => {
        if (selectedAsset && onSelect) {
            onSelect(selectedAsset);
            onClose();
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            size={size}
            title={title}
            className="unified-image-modal"
            zIndexLayer={zIndexLayer}
            footer={
                <div className="unified-image-modal-footer">
                    {onSelect && (
                        <TextButton
                            variant="primary"
                            onClick={handleConfirmSelect}
                            disabled={!selectedAsset}
                        >
                            Select
                        </TextButton>
                    )}
                    <TextButton variant="secondary" onClick={onClose}>
                        {onSelect ? 'Cancel' : 'Close'}
                    </TextButton>
                </div>
            }
        >
            <div className="unified-image-modal-content">
                <ImageTabContent
                    mode={mode}
                    objectType={objectType}
                    objectId={objectId}
                    onAssetChange={onAssetChange}
                    manuscriptId={manuscriptId}
                    onSelectionChange={onSelect ? handleSelectionChange : undefined}
                    excludeAssetIds={excludeAssetIds}
                    showImportButton={mode !== 'picker'}
                    showPromptTab={mode === 'object'}
                    sceneContext={sceneContext}
                    onImageGenerated={onImageGenerated}
                    initialGenerationSettings={initialGenerationSettings}
                />
            </div>
        </BaseModal>
    );
};

export default UnifiedImageModal;
