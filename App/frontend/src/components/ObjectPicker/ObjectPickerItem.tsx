/**
 * Individual selectable item in ObjectPicker
 * Simple row with checkbox and name
 */

import React, { useCallback } from 'react';
import type { ObjectPickerItemProps } from './types';

const ObjectPickerItem: React.FC<ObjectPickerItemProps> = ({
  item,
  isSelected,
  isPreSelected = false,
  isHighlighted = false,
  selectionMode,
  onToggle,
  disabled = false,
}) => {
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't toggle if clicking on checkbox directly (it handles itself)
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (!disabled && !isPreSelected) {
      onToggle(item.id);
    }
  }, [item.id, onToggle, disabled, isPreSelected]);

  const handleCheckboxChange = useCallback(() => {
    if (!disabled && !isPreSelected) {
      onToggle(item.id);
    }
  }, [item.id, onToggle, disabled, isPreSelected]);

  const itemClasses = [
    'object-picker-item',
    isSelected && 'selected',
    isPreSelected && 'pre-selected',
    isHighlighted && 'highlighted',
    disabled && 'disabled',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={itemClasses}
      onClick={handleClick}
      role="option"
      aria-selected={isSelected}
    >
      <input
        type={selectionMode === 'single' ? 'radio' : 'checkbox'}
        checked={isSelected}
        onChange={handleCheckboxChange}
        disabled={disabled || isPreSelected}
        aria-label={`Select ${item.name}`}
      />

      <span className="object-picker-item-name">
        {item.name}
      </span>

      {isHighlighted && (
        <span className="object-picker-item-badge">current</span>
      )}

      {item.wordCount !== undefined && (
        <span className="object-picker-item-wordcount">
          {item.wordCount.toLocaleString()}
        </span>
      )}
    </div>
  );
};

export default ObjectPickerItem;
