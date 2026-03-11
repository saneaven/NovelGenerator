import React from 'react';
import { normalizeStringList } from '../../../utils/basicInfo';
import './ReadOnlyBasicInfoDisplay.css';

export interface ReadOnlyBasicInfoDisplayProps {
  title?: string;
  logline?: string;
  genres?: string[];
  tags?: string[];
  mode: 'create' | 'read' | 'replace';
  changedFields?: string[];
}

export const ReadOnlyBasicInfoDisplay: React.FC<ReadOnlyBasicInfoDisplayProps> = ({
  title,
  logline,
  genres,
  tags,
  mode,
  changedFields,
}) => {
  const isChanged = (field: string) =>
    mode === 'replace' && changedFields?.includes(field);

  const genreList = normalizeStringList(genres);
  const tagList = normalizeStringList(tags);
  const hasGenres = genreList.length > 0;
  const hasTags = tagList.length > 0;
  const hasTitle = Boolean(title?.trim());
  const hasLogline = Boolean(logline?.trim());

  // In replace mode with changedFields, only show fields that actually changed
  const showGenres = mode !== 'replace' || !changedFields || changedFields.includes('genres');
  const showTags = mode !== 'replace' || !changedFields || changedFields.includes('tags');
  const showTitle = mode !== 'replace' || !changedFields || changedFields.includes('title');
  const showLogline = mode !== 'replace' || !changedFields || changedFields.includes('logline');

  return (
    <div className="ro-basic-info">
      {showGenres && (
        <div className="ro-basic-info__badge-row">
          {hasGenres ? (
            genreList.map((genreValue) => (
              <span
                key={genreValue}
                className={`ro-basic-info__genre-badge${isChanged('genres') ? ' ro-basic-info--changed' : ''}`}
              >
                {genreValue}
              </span>
            ))
          ) : (
            <span
              className={`ro-basic-info__genre-badge${isChanged('genres') ? ' ro-basic-info--changed' : ''}`}
            >
              Uncategorized
            </span>
          )}
        </div>
      )}

      {showTitle && (
        <h3
          className={`ro-basic-info__title${isChanged('title') ? ' ro-basic-info--changed' : ''}`}
        >
          {hasTitle ? title : 'Untitled Story'}
        </h3>
      )}

      {showTags && (
        <div className={`ro-basic-info__meta-section${isChanged('tags') ? ' ro-basic-info--changed' : ''}`}>
          <span className="ro-basic-info__meta-label">Tags</span>
          {hasTags ? (
            <div className="ro-basic-info__meta-chip-wrap">
              {tagList.map((tagValue) => (
                <span key={tagValue} className="ro-basic-info__meta-chip">
                  {tagValue}
                </span>
              ))}
            </div>
          ) : (
            <span className="ro-basic-info__empty">No tags provided.</span>
          )}
        </div>
      )}

      {showLogline && (showGenres || showTags || showTitle) && (
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
