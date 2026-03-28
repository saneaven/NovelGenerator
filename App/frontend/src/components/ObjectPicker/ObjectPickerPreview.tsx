/**
 * Preview panel/modal for ObjectPicker
 */

import React, { useCallback } from 'react';
import { getAnyObjectTypeLabel } from '../../types/timeline';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ObjectPickerPreviewProps } from './types';

const ObjectPickerPreview: React.FC<ObjectPickerPreviewProps> = ({
  item,
  position,
  onClose,
}) => {
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  }, [onClose]);

  // Side panel mode
  if (position === 'side') {
    return (
      <div className="object-picker-preview object-picker-preview-side">
        {!item ? (
          <div className="object-picker-preview-empty">
            Select an item to preview
          </div>
        ) : (
          <div className="object-picker-preview-content">
            <div className="object-picker-preview-header">
              <span className="object-picker-type-badge">
                {getAnyObjectTypeLabel(item.type)}
              </span>
              <h3 className="object-picker-preview-title">{item.name}</h3>
            </div>

            {item.wordCount !== undefined && (
              <div className="object-picker-preview-meta">
                <span className="object-picker-preview-wordcount">
                  {item.wordCount.toLocaleString()} words
                </span>
              </div>
            )}

            {item.content && (
              <div className="object-picker-preview-description">
                <MarkdownRenderer className="markdown-content object-picker-preview-description-markdown">
                  {item.content}
                </MarkdownRenderer>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Modal mode
  if (!item) return null;

  return (
    <div className="object-picker-preview-overlay" onClick={handleOverlayClick}>
      <div className="object-picker-preview object-picker-preview-modal">
        <div className="object-picker-preview-header">
          <div className="object-picker-preview-header-content">
            <span className="object-picker-type-badge">
              {getAnyObjectTypeLabel(item.type)}
            </span>
            <h3 className="object-picker-preview-title">{item.name}</h3>
          </div>
          <button
            type="button"
            className="object-picker-preview-close"
            onClick={onClose}
            aria-label="Close preview"
          >
            ×
          </button>
        </div>

        {item.wordCount !== undefined && (
          <div className="object-picker-preview-meta">
            <span className="object-picker-preview-wordcount">
              {item.wordCount.toLocaleString()} words
            </span>
          </div>
        )}

        {item.content && (
          <div className="object-picker-preview-description">
            <MarkdownRenderer className="markdown-content object-picker-preview-description-markdown">
              {item.content}
            </MarkdownRenderer>
          </div>
        )}
      </div>
    </div>
  );
};

export default ObjectPickerPreview;
