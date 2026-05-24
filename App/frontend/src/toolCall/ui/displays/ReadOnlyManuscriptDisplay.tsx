import React, { useMemo } from 'react';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';

export interface ReadOnlyManuscriptDisplayProps {
  title?: string;
  contentMarkdown?: string;
  offset?: { from?: number; to?: number } | null;
}

export const ReadOnlyManuscriptDisplay: React.FC<ReadOnlyManuscriptDisplayProps> = ({
  title,
  contentMarkdown,
  offset,
}) => {
  const resolved = useMemo(() => contentMarkdown ?? '', [contentMarkdown]);

  return (
    <div className="function-call-manuscript-readonly">
      {(title || offset) && (
        <div className="function-call-manuscript-readonly__meta-row">
          {title && <span className="function-call-manuscript-readonly__title">{title}</span>}
          {offset && (
            <span className="function-call-manuscript-readonly__range">
              Paragraphs {offset.from ?? 0} - {offset.to ?? 0}
            </span>
          )}
        </div>
      )}

      <div className="function-call-manuscript-readonly__body">
        {resolved.trim()
          ? <MarkdownRenderer className="function-call-manuscript-readonly__markdown">{resolved}</MarkdownRenderer>
          : <span className="function-call-manuscript-readonly__empty">(empty manuscript)</span>}
      </div>
    </div>
  );
};

export default ReadOnlyManuscriptDisplay;
