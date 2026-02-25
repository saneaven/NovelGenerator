import React from 'react';
import './ReadOnlyBasicInfoDisplay.css';

export interface ReadOnlyBasicInfoDisplayProps {
  title?: string;
  logline?: string;
  genre?: string;
  mode: 'create' | 'replace';
  changedFields?: string[];
}

export const ReadOnlyBasicInfoDisplay: React.FC<ReadOnlyBasicInfoDisplayProps> = ({
  title,
  logline,
  genre,
  mode,
  changedFields,
}) => {
  const isChanged = (field: string) =>
    mode === 'replace' && changedFields?.includes(field);

  const hasGenre = Boolean(genre?.trim());
  const hasTitle = Boolean(title?.trim());
  const hasLogline = Boolean(logline?.trim());

  // In replace mode with changedFields, only show fields that actually changed
  const showGenre = mode !== 'replace' || !changedFields || changedFields.includes('genre');
  const showTitle = mode !== 'replace' || !changedFields || changedFields.includes('title');
  const showLogline = mode !== 'replace' || !changedFields || changedFields.includes('logline');

  return (
    <div className="ro-basic-info">
      {showGenre && (
        <div className="ro-basic-info__badge-row">
          <span
            className={`ro-basic-info__genre-badge${isChanged('genre') ? ' ro-basic-info--changed' : ''}`}
          >
            {hasGenre ? genre : 'Uncategorized'}
          </span>
        </div>
      )}

      {showTitle && (
        <h3
          className={`ro-basic-info__title${isChanged('title') ? ' ro-basic-info--changed' : ''}`}
        >
          {hasTitle ? title : 'Untitled Story'}
        </h3>
      )}

      {showLogline && (showGenre || showTitle) && (
        <hr className="ro-basic-info__divider" />
      )}

      {showLogline && (
        <div
          className={`ro-basic-info__logline-section${isChanged('logline') ? ' ro-basic-info--changed' : ''}`}
        >
          <span className="ro-basic-info__logline-label">Logline</span>
          <p className="ro-basic-info__logline-text">
            {hasLogline ? logline : <span className="ro-basic-info__empty">No logline provided.</span>}
          </p>
        </div>
      )}
    </div>
  );
};

export default ReadOnlyBasicInfoDisplay;
