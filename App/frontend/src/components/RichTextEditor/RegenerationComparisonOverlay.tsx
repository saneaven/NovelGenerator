/**
 * RegenerationComparisonOverlay - Shows new image after regeneration
 * User can choose to replace the original or discard the new image
 */

import React from 'react';
import type { Asset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import BaseModal from '../BaseModal/BaseModal';
import { TextButton } from '../TextButton';
import './RegenerationComparisonOverlay.css';

interface RegenerationComparisonOverlayProps {
    isOpen: boolean;
    newAsset: Asset | null;
    onUse: () => void;      // Replace original with new
    onDiscard: () => void;  // Keep original, new stays in library
}

const RegenerationComparisonOverlay: React.FC<RegenerationComparisonOverlayProps> = ({
    isOpen,
    newAsset,
    onUse,
    onDiscard,
}) => {
    const footer = (
        <div className="comparison-actions">
            <TextButton variant="secondary" onClick={onDiscard}>
                Discard
            </TextButton>
            <TextButton variant="primary" onClick={onUse}>
                Use This
            </TextButton>
        </div>
    );

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onDiscard}
            title="Regenerated Image"
            size="small"
            footer={footer}
            className="regeneration-comparison-modal"
        >
            {newAsset && (
                <>
                    <img
                        src={`${API_BASE_URL}${newAsset.file_url}`}
                        alt="Regenerated"
                        className="regeneration-new-image"
                    />
                    <p className="regeneration-hint">New image will be saved to library either way</p>
                </>
            )}
        </BaseModal>
    );
};

export default RegenerationComparisonOverlay;
