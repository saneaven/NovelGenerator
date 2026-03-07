import React from 'react';
import { motion } from 'motion/react';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import { IconButton } from '../../IconButton';
import { Expand } from '../../icons';
import { useFitText } from '../../../hooks/useFitText';
import type { SpanType } from '../../../hooks/useCardSpanType';
import './StoryObjectCards.css';

export interface StoryObjectCardProps {
  /** Display name / title */
  name: string;
  /** One-line subtitle shown in expanded or text-only mode */
  description?: string;
  /** Main body content (markdown) */
  content?: string;
  /** Image URL (already resolved) */
  imageUrl?: string | null;

  /** Card expand state — controls description-wrapper visibility */
  expanded?: boolean;
  /** Grid span type for layout */
  spanType?: SpanType;
  /** Additional CSS class (e.g. 'function-call-readonly-item') */
  className?: string;
  /** Optional drag handle slot rendered inside the card */
  dragHandle?: React.ReactNode;

  // --- Interactive variant only ---
  /** Framer Motion layoutId for shared-layout animation */
  layoutId?: string;
  /** When true, card fades to 0 (slot held for overlay) */
  isFullExpanded?: boolean;
  /** Elevates z-index during layout animation */
  isAnimating?: boolean;
  /** Toggle State 1 ↔ 2 */
  onToggleExpand?: () => void;
  /** Open State 3 (full edit overlay) */
  onOpenFullExpand?: () => void;
  /** Called when layout animation finishes */
  onAnimationComplete?: () => void;
}

const StoryObjectCardInner: React.FC<StoryObjectCardProps> = ({
  name,
  description,
  content,
  imageUrl,
  expanded = false,
  spanType,
  className,
  dragHandle,
  layoutId,
  isFullExpanded,
  isAnimating,
  onToggleExpand,
  onOpenFullExpand,
  onAnimationComplete,
}) => {
  const isTextOnly = spanType === 'text-only';
  const hasImage = Boolean(imageUrl);
  const isInteractive = Boolean(layoutId);
  const showSubtitle = (expanded || isTextOnly) && description;

  // Dynamic font scaling for text-only cards in grid context (not readonly)
  const enableFitText = isTextOnly && !className;
  const { containerRef, textRef, fontSize, isReady } = useFitText({
    minFontSize: 16,
    maxFontSize: 48,
    text: name,
  });

  const cardClassName = [
    'story-object-card',
    isAnimating ? 'story-object-card--animating' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const cardContent = (
    <>
      {/* Expand button — only for interactive variant */}
      {onOpenFullExpand && (
        <IconButton
          icon={<Expand size="md" />}
          onClick={onOpenFullExpand}
          ariaLabel="Open edit panel"
          title="Edit"
          size="sm"
          className="story-object-card__full-expand-btn"
        />
      )}

      {dragHandle && (
        <div className="story-object-card__drag-slot">
          {dragHandle}
        </div>
      )}

      {/* Content */}
      <div className="story-object-card__content">
        <div className="story-object-card__body-shell">
          {/* Header — always visible */}
          <header className="story-object-card__header">
            {enableFitText ? (
              <div
                ref={containerRef}
                className="story-object-card__title-container"
              >
                <h4
                  ref={textRef as React.RefObject<HTMLHeadingElement>}
                  className="story-object-card__title story-object-card__title--no-toggle story-object-card__title--fit"
                  style={{
                    fontSize: isReady ? `${fontSize}px` : undefined,
                    opacity: isReady ? 1 : 0,
                  }}
                >
                  {name}
                </h4>
              </div>
            ) : onToggleExpand ? (
              <h4
                className="story-object-card__title"
                onClick={onToggleExpand}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onToggleExpand()}
              >
                {name}
              </h4>
            ) : (
              <h4 className="story-object-card__title story-object-card__title--no-toggle">
                {name}
              </h4>
            )}

            {showSubtitle && (
              <p className="story-object-card__subtitle">{description}</p>
            )}
          </header>

          {/* Content — always in DOM, CSS controls visibility via max-height */}
          <div className="story-object-card__description-wrapper">
            <div className="story-object-card__description">
              <MarkdownRenderer>
                {content || 'No content.'}
              </MarkdownRenderer>
            </div>
          </div>
        </div>
      </div>

      {/* Image */}
      {hasImage && (
        <div className="story-object-card__image-container">
          <img
            src={imageUrl || ''}
            alt={name}
            className="story-object-card__image"
            loading="lazy"
          />
        </div>
      )}
    </>
  );

  if (isInteractive) {
    return (
      <motion.article
        layoutId={layoutId}
        className={cardClassName}
        data-expanded={expanded}
        data-has-image={hasImage}
        data-span={spanType}
        initial={false}
        animate={{ opacity: isFullExpanded ? 0 : 1 }}
        whileHover={{ y: -4 }}
        transition={{ opacity: { duration: 0.15 } }}
        onAnimationComplete={onAnimationComplete}
      >
        {cardContent}
      </motion.article>
    );
  }

  return (
    <article
      className={cardClassName}
      data-expanded={expanded}
      data-has-image={hasImage}
      data-span={spanType}
    >
      {cardContent}
    </article>
  );
};

export const StoryObjectCard = React.memo(StoryObjectCardInner);
