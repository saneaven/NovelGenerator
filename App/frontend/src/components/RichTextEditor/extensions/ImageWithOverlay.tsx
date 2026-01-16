/**
 * Custom Image Extension with Overlay
 * Extends TipTap's Image extension with interactive overlay for Replace and Delete actions
 */

import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ImageNodeView from './ImageNodeView';

export const ImageWithOverlay = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            // Store asset ID for direct lookup (optional - can also lookup by URL)
            'data-asset-id': {
                default: null,
                parseHTML: (element) => element.getAttribute('data-asset-id'),
                renderHTML: (attributes) => {
                    if (!attributes['data-asset-id']) return {};
                    return { 'data-asset-id': attributes['data-asset-id'] };
                },
            },
        };
    },

    addNodeView() {
        return ReactNodeViewRenderer(ImageNodeView);
    },
});

export default ImageWithOverlay;
