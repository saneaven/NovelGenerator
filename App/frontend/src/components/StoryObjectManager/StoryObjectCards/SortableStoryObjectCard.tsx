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
import type { SpanType } from '../../../hooks/useCardSpanType';
import DragHandle from '../../ui/DragHandle';

interface SortableStoryObjectCardProps {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
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

  const dragHandle = (
    <DragHandle
      orientation="horizontal"
      disabled={disabled}
      handleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>}
    />
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="sortable-card-wrapper"
      data-span={spanType}
    >
      {children(dragHandle)}
    </div>
  );
};

export default SortableStoryObjectCard;
