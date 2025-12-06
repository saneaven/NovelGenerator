/**
 * ImageNodeView - Custom TipTap NodeView for images with overlay
 * Shows action buttons on hover: Regenerate, Replace, Delete
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import type { Asset } from '../../../api/assetService';
import './ImageNodeView.css';

// Storage keys for extension callbacks
export const IMAGE_OVERLAY_STORAGE_KEY = 'imageOverlayCallbacks';

export interface ImageOverlayCallbacks {
    projectId?: string;
    onReplace?: (currentSrc: string) => void;
    onRegenerate?: (asset: Asset, imageBounds: DOMRect) => void;
    getAssetByUrl?: (src: string) => Promise<Asset | null>;
}

const ImageNodeView: React.FC<NodeViewProps> = ({
    node,
    deleteNode,
    selected,
    editor,
}) => {
    const [showOverlay, setShowOverlay] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [asset, setAsset] = useState<Asset | null>(null);
    const [isLoadingAsset, setIsLoadingAsset] = useState(false);
    const [isTouchDevice, setIsTouchDevice] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const src = node.attrs.src as string;
    const alt = node.attrs.alt as string;

    // Detect touch device
    useEffect(() => {
        setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    }, []);

    // Get callbacks from editor storage
    // Use type assertion - TipTap storage is dynamically typed per extension
    const callbacks = (editor.storage as unknown as Record<string, unknown>)[IMAGE_OVERLAY_STORAGE_KEY] as ImageOverlayCallbacks | undefined;

    // Load asset metadata when image src changes
    useEffect(() => {
        const loadAsset = async () => {
            if (!callbacks?.getAssetByUrl || !src) {
                setAsset(null);
                return;
            }

            setIsLoadingAsset(true);
            try {
                const foundAsset = await callbacks.getAssetByUrl(src);
                setAsset(foundAsset);
            } catch (error) {
                console.error('Failed to load asset metadata:', error);
                setAsset(null);
            } finally {
                setIsLoadingAsset(false);
            }
        };

        loadAsset();
    }, [src, callbacks]);

    // Check if image has generation data (can be regenerated)
    const canRegenerate = asset && (
        asset.generation_prompt ||
        asset.generation_positive_prompt
    );

    // Handle hover for desktop
    const handleMouseEnter = useCallback(() => {
        if (!isTouchDevice && !showDeleteConfirm) {
            setShowOverlay(true);
        }
    }, [isTouchDevice, showDeleteConfirm]);

    const handleMouseLeave = useCallback(() => {
        if (!isTouchDevice && !showDeleteConfirm) {
            setShowOverlay(false);
        }
    }, [isTouchDevice, showDeleteConfirm]);

    // Handle click for mobile (toggle overlay)
    const handleClick = useCallback((e: React.MouseEvent) => {
        if (isTouchDevice && !showDeleteConfirm) {
            e.preventDefault();
            e.stopPropagation();
            setShowOverlay((prev) => !prev);
        }
    }, [isTouchDevice, showDeleteConfirm]);

    // Handle regenerate
    const handleRegenerate = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!asset || !callbacks?.onRegenerate || !imageRef.current) return;

        const bounds = imageRef.current.getBoundingClientRect();
        callbacks.onRegenerate(asset, bounds);
        setShowOverlay(false);
    }, [asset, callbacks]);

    // Handle replace
    const handleReplace = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!callbacks?.onReplace) return;

        callbacks.onReplace(src);
        setShowOverlay(false);
    }, [src, callbacks]);

    // Handle delete (show confirmation)
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShowDeleteConfirm(true);
    }, []);

    // Confirm delete
    const confirmDelete = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        deleteNode();
        setShowDeleteConfirm(false);
        setShowOverlay(false);
    }, [deleteNode]);

    // Cancel delete
    const cancelDelete = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShowDeleteConfirm(false);
    }, []);

    // Close overlay when clicking outside (for mobile)
    useEffect(() => {
        if (!isTouchDevice || !showOverlay) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setShowOverlay(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isTouchDevice, showOverlay]);

    return (
        <NodeViewWrapper
            as="span"
            className={`image-node-wrapper ${selected ? 'selected' : ''} ${showOverlay || showDeleteConfirm ? 'active' : ''}`}
            ref={wrapperRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            data-drag-handle
        >
            <img
                ref={imageRef}
                src={src}
                alt={alt || ''}
                className="novel-inline-image"
                draggable={false}
            />

            {/* Action overlay */}
            {(showOverlay || showDeleteConfirm) && !showDeleteConfirm && (
                <div className="image-overlay">
                    <div className="overlay-buttons">
                        {/* Regenerate - only for generated images */}
                        {canRegenerate && (
                            <button
                                type="button"
                                onClick={handleRegenerate}
                                title="Regenerate image"
                                disabled={isLoadingAsset}
                            >
                                🔄
                            </button>
                        )}

                        {/* Replace */}
                        <button
                            type="button"
                            onClick={handleReplace}
                            title="Replace image"
                        >
                            🔀
                        </button>
                    </div>

                    {/* Delete - separated from other buttons */}
                    <button
                        type="button"
                        className="delete-btn"
                        onClick={handleDelete}
                        title="Remove image"
                    >
                        🗑️
                    </button>
                </div>
            )}

            {/* Delete confirmation dialog */}
            {showDeleteConfirm && (
                <div className="delete-confirm-overlay">
                    <div className="delete-confirm-dialog">
                        <p>Remove this image from the editor?</p>
                        <p className="hint">(Image will remain in the library)</p>
                        <div className="confirm-buttons">
                            <button type="button" onClick={confirmDelete}>
                                Remove
                            </button>
                            <button type="button" onClick={cancelDelete}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </NodeViewWrapper>
    );
};

export default ImageNodeView;
