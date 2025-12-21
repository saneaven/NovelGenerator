import React from 'react';
import type { FunctionCallOperationPreview } from '../../llm/requestTypes';
import { ActionBadge } from './ActionBadge';

interface OperationPreviewProps {
  preview: FunctionCallOperationPreview;
  compact?: boolean;
}

export const OperationPreview: React.FC<OperationPreviewProps> = ({ preview, compact = false }) => {
  const hasFields = preview.fields && preview.fields.length > 0;
  const hasChapters = preview.chapters && preview.chapters.length > 0;
  const hasReplacements = preview.replacements && preview.replacements.length > 0;
  const showTarget = preview.targetName && preview.action !== 'create';
  const failedIndices = new Set(preview.failedReplacementIndices ?? []);

  return (
    <div className={`fc-preview ${compact ? 'fc-preview--compact' : ''}`}>
      <div className="fc-preview__header">
        <ActionBadge action={preview.action} type={preview.type} />

        {preview.targetLanguage && (
          <span className="fc-preview__lang">{preview.targetLanguage.toUpperCase()}</span>
        )}
      </div>

      {showTarget && (
        <div className="fc-preview__target">
          <span className="fc-preview__target-name">{preview.targetName}</span>
        </div>
      )}

      {/* Replacements for PATCH operations */}
      {hasReplacements && !compact && (
        <div className="fc-preview__replacements">
          {preview.replacements!.map((r, idx) => {
            const isFailed = failedIndices.has(idx);
            return (
              <div
                key={idx}
                className={`fc-preview__replacement ${isFailed ? 'fc-preview__replacement--failed' : ''}`}
              >
                {r.field && <span className="fc-preview__replacement-field">{r.field}:</span>}
                <span className="fc-preview__replacement-old">{r.old}</span>
                <span className="fc-preview__replacement-arrow">→</span>
                <span className="fc-preview__replacement-new">{r.new}</span>
                {isFailed && <span className="fc-preview__replacement-error">Not found</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Inline chips for fields */}
      {hasFields && !compact && !hasReplacements && (
        <div className="fc-preview__chips">
          {preview.fields!.map((field) => (
            <span key={field.key} className="fc-preview__chip">
              <span className="fc-preview__chip-label">{field.label}:</span>
              <span className="fc-preview__chip-value">{field.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Chapters */}
      {hasChapters && !compact && (
        <div className="fc-preview__chapters">
          {preview.chapters!.map((chapter, index) => (
            <span key={chapter.name || `chapter-${index}`} className="fc-preview__chip">
              {chapter.name || `Chapter ${index + 1}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
