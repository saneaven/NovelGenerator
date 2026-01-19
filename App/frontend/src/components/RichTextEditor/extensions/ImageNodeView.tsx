/**
 * ImageNodeView - Custom TipTap NodeView for images with overlay
 * Shows action buttons on hover: Change, Regenerate, Delete
 */

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import { IconButton } from '../../IconButton';
import { TextButton } from '../../TextButton';
import { Shuffle, Trash, Refresh } from '../../icons';
import { API_BASE_URL } from '../../../api/client';
import './ImageNodeView.css';

// Storage keys for extension callbacks
export const IMAGE_OVERLAY_STORAGE_KEY = 'imageOverlayCallbacks';

export interface ImageOverlayCallbacks {
    // Change image - opens asset library modal (user manually selects replacement)
    onSwapImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
    // Regenerate image - opens generation panel with the original settings prefilled (library-only)
    onRegenerateImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
}

const ImageNodeView: React.FC<NodeViewProps> = ({
    node,
    deleteNode,
    selected,
    editor,
}) => {
    const [showOverlay, setShowOverlay] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isTouchDevice, setIsTouchDevice] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const src = node.attrs.src as string;
    const alt = node.attrs.alt as string;

    const resolvedSrc = useMemo(() => {
        if (!src) return src;
        if (src.startsWith('/')) return `${API_BASE_URL}${src}`;
        return src;
    }, [src]);

    // Detect touch device
    useEffect(() => {
        setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    }, []);

    // Get callbacks from editor storage
    // Use type assertion - TipTap storage is dynamically typed per extension
    const callbacks = (editor.storage as unknown as Record<string, unknown>)[IMAGE_OVERLAY_STORAGE_KEY] as ImageOverlayCallbacks | undefined;

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

    // Handle swap image - opens modal with EMPTY prompts
    const handleSwapImage = useCallback(() => {
        if (!callbacks?.onSwapImage) return;

        const bounds = imageRef.current?.getBoundingClientRect() || null;
        callbacks.onSwapImage(src, bounds);
        setShowOverlay(false);
    }, [src, callbacks]);

    const handleRegenerateImage = useCallback(() => {
        if (!callbacks?.onRegenerateImage) return;

        const bounds = imageRef.current?.getBoundingClientRect() || null;
        callbacks.onRegenerateImage(src, bounds);
        setShowOverlay(false);
    }, [src, callbacks]);

    // Handle delete (show confirmation)
    const handleDelete = useCallback(() => {
        setShowDeleteConfirm(true);
    }, []);

    // Confirm delete
    const confirmDelete = useCallback(() => {
        deleteNode();
        setShowDeleteConfirm(false);
        setShowOverlay(false);
    }, [deleteNode]);

    // Cancel delete
    const cancelDelete = useCallback(() => {
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
                src={resolvedSrc}
                alt={alt || ''}
                className="novel-inline-image"
                draggable={false}
            />

            {/* Action overlay - always rendered, visibility controlled by CSS */}
            {!showDeleteConfirm && (
                <div className="image-overlay" onClick={(e) => e.stopPropagation()}>
                    <div className="overlay-buttons">
                        {callbacks?.onSwapImage && (
                            <IconButton
                                icon={<Shuffle size="md" />}
                                onClick={handleSwapImage}
                                title="Change image"
                                size="sm"
                            />
                        )}
                        {callbacks?.onRegenerateImage && (
                            <IconButton
                                icon={<Refresh size="md" />}
                                onClick={handleRegenerateImage}
                                title="Regenerate image"
                                size="sm"
                            />
                        )}
                    </div>

                    {/* Delete - separated from other buttons */}
                    <IconButton
                        icon={<Trash size="md" />}
                        onClick={handleDelete}
                        title="Remove image"
                        size="sm"
                        variant="danger"
                        className="delete-btn"
                    />
                </div>
            )}

            {/* Delete confirmation dialog */}
            {showDeleteConfirm && (
                <div className="delete-confirm-overlay" onClick={(e) => e.stopPropagation()}>
                    <div className="delete-confirm-dialog">
                        <p>Remove this image from the editor?</p>
                        <p className="hint">(Image will remain in the library)</p>
                        <div className="confirm-buttons">
                            <TextButton variant="danger" size="sm" onClick={confirmDelete}>
                                Remove
                            </TextButton>
                            <TextButton variant="secondary" size="sm" onClick={cancelDelete}>
                                Cancel
                            </TextButton>
                        </div>
                    </div>
                </div>
            )}
        </NodeViewWrapper>
    );
};

export default ImageNodeView;
