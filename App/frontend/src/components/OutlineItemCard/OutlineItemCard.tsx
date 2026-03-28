import React from 'react';

import { Warning } from '../icons';
import { MarkdownRenderer } from '../MarkdownRenderer';
import './OutlineItemCard.css';

export type OutlineItemVariant = 'outline' | 'act' | 'chapter';

export interface OutlineItemCardProps {
  variant: OutlineItemVariant;
  name: string;
  description?: string;
  contentMarkdown?: string;
  chapterIndex?: number;
  meta?: string;
  expanded?: boolean;
  readOnly?: boolean;
  showFallbackWarning?: boolean;
  footerActions?: React.ReactNode;
  onHeaderClick?: () => void;
  className?: string;
  dragHandle?: React.ReactNode;
}

export function toOutlineItemVariant(objectType: string, kind?: string): OutlineItemVariant {
  if (objectType === 'outline' && kind === 'act') return 'act';
  if (objectType === 'outline' && kind === 'chapter') return 'chapter';
  if (objectType === 'act') return 'act';
  if (objectType === 'chapter') return 'chapter';
  return 'outline';
}

interface OutlineCardPreviewProps {
  contentMarkdown?: string;
  className?: string;
}

const OutlineCardPreview = React.memo(function OutlineCardPreview({
  contentMarkdown,
  className,
}: OutlineCardPreviewProps) {
  if (contentMarkdown?.trim()) {
    return <MarkdownRenderer className={className}>{contentMarkdown}</MarkdownRenderer>;
  }
  return <p className="placeholder-text">No content provided.</p>;
}, (prevProps, nextProps) => (
  prevProps.contentMarkdown === nextProps.contentMarkdown &&
  prevProps.className === nextProps.className
));

const OutlineItemCardInner: React.FC<OutlineItemCardProps> = ({
  variant,
  name,
  description,
  contentMarkdown,
  chapterIndex,
  meta,
  expanded = false,
  readOnly = false,
  showFallbackWarning = false,
  footerActions,
  onHeaderClick,
  className,
  dragHandle,
}) => {
  const isExpanded = readOnly || expanded;
  const rootClassName = [
    'outline-item-card',
    readOnly ? 'outline-item-card--readonly' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  if (variant === 'chapter') {
    return (
      <div className={rootClassName}>
        <div className="content-card chapter-card">
          {dragHandle && (
            <div className="outline-item-card__drag-slot">
              {dragHandle}
            </div>
          )}
          <div className="chapter-header">
            <div className="chapter-info" onClick={readOnly ? undefined : onHeaderClick}>
              {chapterIndex != null && (
                <span className="chapter-index">CH {chapterIndex}</span>
              )}
              <h4>{name || 'Untitled Chapter'}</h4>
              {showFallbackWarning && <Warning size="xs" className="warning-icon" />}
            </div>
          </div>
          {isExpanded && description && (
            <p className="card-description">{description}</p>
          )}
          <div className={`chapter-expand-wrapper ${isExpanded ? 'is-expanded' : ''}`}>
            <div className="chapter-expand-content">
              <OutlineCardPreview contentMarkdown={contentMarkdown} className="markdown-content chapter-content" />
              {!readOnly && footerActions && (
                <div className="chapter-footer-actions">
                  {footerActions}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const cardClass = variant === 'act' ? 'act-card' : 'outline-card';

  return (
    <div className={rootClassName}>
      <div className={`content-card ${cardClass}`}>
        {dragHandle && (
          <div className="outline-item-card__drag-slot">
            {dragHandle}
          </div>
        )}
        <div className="card-header">
          <div className="card-title-section" onClick={readOnly ? undefined : onHeaderClick}>
            <div className="title-row">
              <h4>{name || (variant === 'act' ? 'Untitled Act' : 'Untitled Outline')}</h4>
              {showFallbackWarning && (
                <span className="fallback-badge" title="Translation missing">
                  <Warning size="xs" />
                </span>
              )}
            </div>
            {meta && <span className="card-meta">{meta}</span>}
          </div>
        </div>
        {isExpanded && description && (
          <p className="card-description">{description}</p>
        )}
        <div className={`card-body-wrapper ${isExpanded ? 'is-expanded' : ''}`}>
          <div className="card-body-content">
            <OutlineCardPreview contentMarkdown={contentMarkdown} className="markdown-content" />
            {!readOnly && footerActions && (
              <div className="card-footer-actions">
                {footerActions}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const OutlineItemCard = React.memo(OutlineItemCardInner);
