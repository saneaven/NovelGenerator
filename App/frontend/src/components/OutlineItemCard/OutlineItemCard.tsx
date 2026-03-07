import React from 'react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { Warning } from '../icons';
import './OutlineItemCard.css';

export type OutlineItemVariant = 'outline' | 'act' | 'chapter';

export interface OutlineItemCardProps {
  variant: OutlineItemVariant;
  name: string;
  description?: string;
  content?: string;
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

export function toOutlineItemVariant(objectType: string): OutlineItemVariant {
  if (objectType === 'outline_act') return 'act';
  if (objectType === 'outline_chapter') return 'chapter';
  return 'outline';
}

export const OutlineItemCard: React.FC<OutlineItemCardProps> = ({
  variant,
  name,
  description,
  content,
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
  const hasDragHandle = Boolean(dragHandle);

  const rootClassName = [
    'outline-item-card',
    readOnly ? 'outline-item-card--readonly' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  if (variant === 'chapter') {
    return (
      <div className={rootClassName} data-has-drag-handle={hasDragHandle}>
        <div className="outline-item-card__layout">
          {dragHandle && (
            <div className="outline-item-card__drag-slot">
              {dragHandle}
            </div>
          )}
          <div className="outline-item-card__main">
            <div className="content-card chapter-card">
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
                  {content ? (
                    <MarkdownRenderer className="markdown-content chapter-content">
                      {content}
                    </MarkdownRenderer>
                  ) : (
                    <p className="placeholder-text">No content provided.</p>
                  )}
                  {!readOnly && footerActions && (
                    <div className="chapter-footer-actions">
                      {footerActions}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Act or Outline variant
  const cardClass = variant === 'act' ? 'act-card' : 'outline-card';

  return (
    <div className={rootClassName} data-has-drag-handle={hasDragHandle}>
      <div className="outline-item-card__layout">
        {dragHandle && (
          <div className="outline-item-card__drag-slot">
            {dragHandle}
          </div>
        )}
        <div className="outline-item-card__main">
          <div className={`content-card ${cardClass}`}>
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
                {content ? (
                  <MarkdownRenderer>{content}</MarkdownRenderer>
                ) : (
                  <p className="placeholder-text">No content provided.</p>
                )}
                {!readOnly && footerActions && (
                  <div className="card-footer-actions">
                    {footerActions}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
