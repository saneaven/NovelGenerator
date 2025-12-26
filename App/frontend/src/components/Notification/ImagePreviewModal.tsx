import React, { useEffect, useState } from 'react';
import { BaseModal } from '../BaseModal';
import { assetService, type Asset } from '../../api/assetService';
import { useProjectStore } from '../../store/projectStore';
import { TextButton } from '../TextButton';
import './ImagePreviewModal.css';

interface ImagePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    assetId: string;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
    isOpen,
    onClose,
    assetId,
}) => {
    const { currentProjectId } = useProjectStore();
    const [asset, setAsset] = useState<Asset | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !currentProjectId || !assetId) return;

        const fetchAsset = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const fetchedAsset = await assetService.getAsset(currentProjectId, assetId);
                setAsset(fetchedAsset);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load image');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAsset();
    }, [isOpen, currentProjectId, assetId]);

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            size="large"
            title={asset?.name || 'Generated Image'}
            className="image-preview-modal"
            footer={
                <TextButton variant="secondary" onClick={onClose}>
                    Close
                </TextButton>
            }
        >
            <div className="image-preview-content">
                {isLoading && (
                    <div className="image-preview-loading">
                        <div className="image-preview-spinner" />
                        <span>Loading image...</span>
                    </div>
                )}
                {error && (
                    <div className="image-preview-error">
                        <span>{error}</span>
                    </div>
                )}
                {!isLoading && !error && asset && (
                    <img
                        src={asset.file_url}
                        alt={asset.name}
                        className="image-preview-image"
                    />
                )}
            </div>
        </BaseModal>
    );
};

export default ImagePreviewModal;
