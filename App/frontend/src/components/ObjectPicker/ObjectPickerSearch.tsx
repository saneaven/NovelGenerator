/**
 * Search and filter bar for ObjectPicker
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ObjectType } from '../../types/unifiedObject';
import type { ObjectPickerSearchProps } from './types';
import { CATEGORY_CONFIG } from './types';
import CustomSelect from '../ui/CustomSelect';

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

  const handleTypeChange = useCallback((newValue: string) => {
    onTypeFilterChange?.(newValue ? (newValue as ObjectType) : null);
  }, [onTypeFilterChange]);

  const typeOptions = useMemo(() => {
    return [
      { value: '', label: 'All Types' },
      ...availableTypes.map(type => ({
        value: type,
        label: CATEGORY_CONFIG[type]?.label || type,
      })),
    ];
  }, [availableTypes]);

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
        <CustomSelect
          className="object-picker-type-filter"
          value={typeFilter || ''}
          onChange={handleTypeChange}
          options={typeOptions}
        />
      )}
    </div>
  );
};

export default ObjectPickerSearch;
