/**
 * RegenerationComparisonOverlay - Shows new image after regeneration
 * User can choose to replace the original or discard the new image
 */

import React from 'react';
import type { Asset } from '../../api/assetService';
import './RegenerationComparisonOverlay.css';

// Get API base URL for image sources
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

interface RegenerationComparisonOverlayProps {
    newAsset: Asset;
    position: DOMRect;
    onUse: () => void;      // Replace original with new
    onDiscard: () => void;  // Keep original, new stays in library
}

const RegenerationComparisonOverlay: React.FC<RegenerationComparisonOverlayProps> = ({
    newAsset,
    position,
    onUse,
    onDiscard,
}) => {
    // Handle backdrop click - treat as discard
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onDiscard();
        }
    };

    // Prevent propagation from dialog
    const handleDialogClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    return (
        <div className="regeneration-overlay" onClick={handleBackdropClick}>
            {/* Semi-transparent backdrop */}
            <div className="regeneration-backdrop" />

            {/* Positioned at original image location */}
            <div
                className="regeneration-comparison"
                style={{
                    top: position.top + window.scrollY,
                    left: position.left + window.scrollX,
                    width: Math.max(position.width, 280),
                }}
                onClick={handleDialogClick}
            >
                {/* New image */}
                <img
                    src={`${API_BASE_URL}${newAsset.file_url}`}
                    alt="Regenerated"
                    className="new-image"
                />

                {/* Action buttons */}
                <div className="comparison-actions">
                    <button
                        type="button"
                        className="use-btn"
                        onClick={onUse}
                    >
                        Use This
                    </button>
                    <button
                        type="button"
                        className="discard-btn"
                        onClick={onDiscard}
                    >
                        Discard
                    </button>
                </div>

                {/* Hint text */}
                <p className="hint">New image will be saved to library either way</p>
            </div>
        </div>
    );
};

export default RegenerationComparisonOverlay;
