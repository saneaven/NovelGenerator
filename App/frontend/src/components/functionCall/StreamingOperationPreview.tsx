import React from 'react';
import type { FunctionCallOperationPreview } from '../../llm/requestTypes';
import { ActionBadge } from './ActionBadge';
import { StreamingFieldDisplay } from './StreamingFieldDisplay';

interface StreamingOperationPreviewProps {
  preview: FunctionCallOperationPreview;
  isStreaming?: boolean;
}

// Fields to skip when displaying (internal/metadata fields)
const SKIP_FIELDS = new Set([
  'action',
  'type',
  'id',
  'targetName',
  'replacements',
  'chapters',
]);

// Fields that should be displayed first (in order)
const PRIORITY_FIELDS = ['name', 'title', 'description', 'content', 'logline'];

/**
 * Sorts fields with priority fields first, then alphabetically
 */
const sortFields = (entries: [string, any][]): [string, any][] => {
  return entries.sort(([keyA], [keyB]) => {
    const indexA = PRIORITY_FIELDS.indexOf(keyA);
    const indexB = PRIORITY_FIELDS.indexOf(keyB);

    // Both are priority fields - sort by priority order
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    // Only A is priority - A comes first
    if (indexA !== -1) return -1;
    // Only B is priority - B comes first
    if (indexB !== -1) return 1;
    // Neither is priority - alphabetical
    return keyA.localeCompare(keyB);
  });
};

export const StreamingOperationPreview: React.FC<StreamingOperationPreviewProps> = ({
  preview,
  isStreaming = false,
}) => {
  const data = preview.data;
  const showTarget = preview.targetName && preview.action !== 'create';

  // Filter and sort fields from data object
  const fields = data
    ? sortFields(
        Object.entries(data).filter(
          ([key, value]) =>
            !SKIP_FIELDS.has(key) &&
            value !== null &&
            value !== undefined &&
            value !== ''
        )
      )
    : [];

  return (
    <div className="fc-streaming-preview">
      {/* Header with action badge */}
      <div className="fc-streaming-preview__header">
        <ActionBadge action={preview.action} type={preview.type} />
        {preview.targetLanguage && (
          <span className="fc-preview__lang">{preview.targetLanguage.toUpperCase()}</span>
        )}
      </div>

      {/* Target name for update/delete operations */}
      {showTarget && (
        <div className="fc-streaming-preview__target">
          <span className="fc-streaming-preview__target-name">{preview.targetName}</span>
        </div>
      )}

      {/* All fields from data object */}
      {fields.length > 0 && (
        <div className="fc-streaming-preview__fields">
          {fields.map(([key, value]) => (
            <StreamingFieldDisplay
              key={key}
              fieldKey={key}
              value={value}
              isStreaming={isStreaming}
            />
          ))}
        </div>
      )}

      {/* Replacements for PATCH operations */}
      {preview.replacements && preview.replacements.length > 0 && (
        <div className="fc-streaming-preview__replacements">
          <div className="fc-streaming-field__label">Replacements</div>
          {preview.replacements.map((r, idx) => {
            const isFailed = preview.failedReplacementIndices?.includes(idx);
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

      {/* Chapters if present */}
      {preview.chapters && preview.chapters.length > 0 && (
        <div className="fc-streaming-preview__chapters">
          <div className="fc-streaming-field__label">Chapters</div>
          <div className="fc-preview__chapters">
            {preview.chapters.map((chapter, index) => (
              <span key={chapter.name || `chapter-${index}`} className="fc-preview__chip">
                {chapter.name || `Chapter ${index + 1}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
