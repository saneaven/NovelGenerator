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
  isExcluded = false,
  selectionMode,
  onToggle,
  disabled = false,
}) => {
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't toggle if clicking on checkbox directly (it handles itself)
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    // Excluded items are not selectable
    if (!disabled && !isPreSelected && !isExcluded) {
      onToggle(item.id);
    }
  }, [item.id, onToggle, disabled, isPreSelected, isExcluded]);

  const handleCheckboxChange = useCallback(() => {
    if (!disabled && !isPreSelected && !isExcluded) {
      onToggle(item.id);
    }
  }, [item.id, onToggle, disabled, isPreSelected, isExcluded]);

  const itemClasses = [
    'object-picker-item',
    isSelected && 'selected',
    isPreSelected && 'pre-selected',
    isHighlighted && 'highlighted',
    isExcluded && 'excluded',
    disabled && 'disabled',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={itemClasses}
      onClick={handleClick}
      role="option"
      aria-selected={isSelected || isExcluded}
    >
      <span className="object-picker-item-name">
        {item.name}
      </span>

      {/* Show "edit target" badge for excluded items */}
      {isExcluded && (
        <span className="object-picker-item-badge edit-target">edit target</span>
      )}

      {/* Show "current" badge for highlighted items (not excluded) */}
      {isHighlighted && !isExcluded && (
        <span className="object-picker-item-badge">current</span>
      )}

      {item.wordCount !== undefined && (
        <span className="object-picker-item-wordcount">
          {item.wordCount.toLocaleString()}
        </span>
      )}

      {/* Checkbox/Radio on the right - excluded items don't show */}
      {!isExcluded && (
        <input
          type={selectionMode === 'single' ? 'radio' : 'checkbox'}
          checked={isSelected}
          onChange={handleCheckboxChange}
          disabled={disabled || isPreSelected}
          aria-label={`Select ${item.name}`}
        />
      )}
    </div>
  );
};

export default ObjectPickerItem;
