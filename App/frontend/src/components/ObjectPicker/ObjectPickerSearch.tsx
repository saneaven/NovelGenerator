/**
 * Search and filter bar for ObjectPicker
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ObjectType } from '../../types/unifiedObject';
import type { ObjectPickerSearchProps } from './types';
import { CATEGORY_CONFIG } from './types';

const ObjectPickerSearch: React.FC<ObjectPickerSearchProps> = ({
  value,
  onChange,
  typeFilter,
  onTypeFilterChange,
  availableTypes = [],
  placeholder = 'Search objects...',
}) => {
  // Debounced search
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [localValue, value, onChange]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  const handleClear = useCallback(() => {
    setLocalValue('');
    onChange('');
  }, [onChange]);

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    onTypeFilterChange?.(newValue ? (newValue as ObjectType) : null);
  }, [onTypeFilterChange]);

  return (
    <div className="object-picker-search">
      <div className="object-picker-search-wrapper">
        <input
          type="text"
          className="object-picker-search-input"
          value={localValue}
          onChange={handleInputChange}
          placeholder={placeholder}
        />
        {localValue && (
          <button
            type="button"
            className="object-picker-search-clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {onTypeFilterChange && availableTypes.length > 1 && (
        <select
          className="object-picker-type-filter"
          value={typeFilter || ''}
          onChange={handleTypeChange}
        >
          <option value="">All Types</option>
          {availableTypes.map(type => (
            <option key={type} value={type}>
              {CATEGORY_CONFIG[type]?.label || type}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

export default ObjectPickerSearch;
