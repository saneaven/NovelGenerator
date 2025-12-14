/**
 * Collapsible Section Component
 * Reusable collapsible container with "select all" checkbox
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronRight } from '../icons';
import './CollapsibleSection.css';

export interface CollapsibleSectionProps {
  /** Section label */
  label: string;
  /** Whether section starts expanded (default: false) */
  defaultExpanded?: boolean;
  /** Controlled expanded state (overrides internal state) */
  expanded?: boolean;
  /** Callback when expand/collapse changes */
  onExpandChange?: (expanded: boolean) => void;
  /** Number of selected items */
  selectedCount: number;
  /** Total number of items */
  totalCount: number;
  /** Callback when checkbox is toggled */
  onToggleAll: (selectAll: boolean) => void;
  /** Additional class name */
  className?: string;
  /** Children content */
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  label,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandChange,
  selectedCount,
  totalCount,
  onToggleAll,
  className = '',
  children,
}) => {
  // Internal state for uncontrolled mode
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  // Use controlled or uncontrolled mode
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  // Handle header click to toggle expand/collapse
  const handleHeaderClick = useCallback(() => {
    const newExpanded = !isExpanded;
    if (controlledExpanded === undefined) {
      setInternalExpanded(newExpanded);
    }
    onExpandChange?.(newExpanded);
  }, [isExpanded, controlledExpanded, onExpandChange]);

  // Handle checkbox click (stop propagation to prevent header click)
  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Handle checkbox change
  const handleCheckboxChange = useCallback(() => {
    // If all selected, deselect all. Otherwise, select all.
    const shouldSelectAll = selectedCount < totalCount;
    onToggleAll(shouldSelectAll);
  }, [onToggleAll, selectedCount, totalCount]);

  // Set indeterminate state on checkbox
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    }
  }, [selectedCount, totalCount]);

  const sectionClasses = [
    'collapsible-section',
    isExpanded && 'expanded',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={sectionClasses}>
      <div className="collapsible-section-header" onClick={handleHeaderClick}>
        <span className="collapsible-section-chevron">
          <ChevronRight size={14} />
        </span>
        <span className="collapsible-section-label">{label}</span>

        <label className="collapsible-section-checkbox" onClick={handleCheckboxClick}>
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={selectedCount === totalCount && totalCount > 0}
            onChange={handleCheckboxChange}
          />
          <span className="collapsible-section-count">
            {selectedCount}/{totalCount}
          </span>
        </label>
      </div>

      {isExpanded && (
        <div className="collapsible-section-content">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
