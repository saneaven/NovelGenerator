import React, { useMemo } from 'react';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { richContentToPlainText } from '../../../utils/richTextPreview';

export interface ReadOnlyManuscriptDisplayProps {
  title?: string;
  content?: string;
  doc?: unknown;
  offset?: { from?: number; to?: number } | null;
}

function resolveContent(content?: string, doc?: unknown): string {
  if (typeof content === 'string') return content;
  return richContentToPlainText(doc);
}

export const ReadOnlyManuscriptDisplay: React.FC<ReadOnlyManuscriptDisplayProps> = ({
  title,
  content,
  doc,
  offset,
}) => {
  const resolved = useMemo(() => resolveContent(content, doc), [content, doc]);

  return (
    <div className="function-call-manuscript-readonly">
      {(title || offset) && (
        <div className="function-call-manuscript-readonly__meta-row">
          {title && <span className="function-call-manuscript-readonly__title">{title}</span>}
          {offset && (
            <span className="function-call-manuscript-readonly__range">
              Range {offset.from ?? 0} - {offset.to ?? 0}
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
