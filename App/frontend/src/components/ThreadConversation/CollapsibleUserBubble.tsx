import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const COLLAPSE_THRESHOLD_PX = 100;

interface CollapsibleUserBubbleProps {
  children: React.ReactNode;
}

const CollapsibleUserBubble: React.FC<CollapsibleUserBubbleProps> = ({ children }) => {
  const { t } = useTranslation();
  const innerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setIsOverflowing(el.scrollHeight > COLLAPSE_THRESHOLD_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsed = isOverflowing && !isExpanded;
  const className = `thread-message-row__content${collapsed ? ' thread-message-row__content--collapsed' : ''}`;

  return (
    <div className={className}>
      <div ref={innerRef} className="thread-message-row__content-inner">
        {children}
      </div>
      {isOverflowing && (
        <button
          type="button"
          className="thread-message-row__collapse-toggle"
          onClick={() => setIsExpanded((v) => !v)}
        >
          {isExpanded ? t('agent.showLess') : t('agent.showMore')}
        </button>
      )}
    </div>
  );
};

export default CollapsibleUserBubble;
