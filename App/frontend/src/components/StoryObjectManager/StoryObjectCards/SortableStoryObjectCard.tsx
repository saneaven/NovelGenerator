/**
 * SortableStoryObjectCard - Wrapper for making story object cards draggable
 *
 * Uses @dnd-kit for drag-and-drop functionality.
 * Wraps children and provides drag handle functionality.
 * Passes through data-span attribute for CSS Grid layout.
 */

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HamburgerMenu } from '../../icons';
import type { SpanType } from '../../../hooks/useCardSpanType';

interface SortableStoryObjectCardProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  spanType?: SpanType;
}

export const SortableStoryObjectCard: React.FC<SortableStoryObjectCardProps> = ({
  id,
  children,
  disabled = false,
  spanType,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="sortable-card-wrapper"
      data-span={spanType}
    >
      <div className="sortable-card-wrapper__drag-handle" {...attributes} {...listeners}>
        <HamburgerMenu size="xs" />
      </div>
      <div className="sortable-card-wrapper__content">
        {children}
      </div>
    </div>
  );
};

export default SortableStoryObjectCard;
