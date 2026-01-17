import React, { useState, useEffect, useCallback } from 'react';
import { useVariableStore } from '../../store/variableStore';
import type { PromptVariable } from '../../types/variables';

// Debounce hook for text/number inputs
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

interface VariableControlProps {
  variable: PromptVariable;
  onValueChange: (id: string, value: string | number | boolean | null) => void;
}

const VariableControl: React.FC<VariableControlProps> = ({ variable, onValueChange }) => {
  const [localValue, setLocalValue] = useState<string>(
    variable.value === null ? '' : String(variable.value)
  );

  // Reset local value when variable changes
  useEffect(() => {
    setLocalValue(variable.value === null ? '' : String(variable.value));
  }, [variable.value]);

  // Debounce for text/number inputs
  const debouncedValue = useDebounce(localValue, 300);

  // Apply debounced value for string/number types
  useEffect(() => {
    if (variable.var_type === 'string' || variable.var_type === 'number') {
      const currentValueStr = variable.value === null ? '' : String(variable.value);
      if (debouncedValue !== currentValueStr) {
        if (variable.var_type === 'number') {
          const numValue = parseFloat(debouncedValue);
          if (!isNaN(numValue)) {
            onValueChange(variable.id, numValue);
          }
        } else {
          onValueChange(variable.id, debouncedValue);
        }
      }
    }
  }, [debouncedValue, variable.var_type, variable.id, variable.value, onValueChange]);

  const handleBooleanChange = () => {
    onValueChange(variable.id, !variable.value);
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onValueChange(variable.id, e.target.value);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  return (
    <div className="variable-control">
      <label className="variable-control__label">
        {variable.name}
        {variable.description && (
          <span className="variable-control__desc" title={variable.description}>
            ?
          </span>
        )}
      </label>
      <div className="variable-control__input">
        {variable.var_type === 'boolean' && (
          <button
            className={`variable-control__toggle ${variable.value ? 'active' : ''}`}
            onClick={handleBooleanChange}
            type="button"
          >
            <span className="variable-control__toggle-track">
              <span className="variable-control__toggle-thumb" />
            </span>
          </button>
        )}

        {variable.var_type === 'select' && variable.select_options && (
          <select
            className="variable-control__select"
            value={variable.value as string || ''}
            onChange={handleSelectChange}
          >
            {variable.select_options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}

        {variable.var_type === 'string' && (
          <input
            type="text"
            className="variable-control__text"
            value={localValue}
            onChange={handleTextChange}
            placeholder="Enter value..."
          />
        )}

        {variable.var_type === 'number' && (
          variable.number_options?.input_type === 'slider' ? (
            <div className="variable-control__slider-wrapper">
              <input
                type="range"
                className="variable-control__slider"
                value={localValue || String(variable.number_options!.min)}
                onChange={handleTextChange}
                min={variable.number_options!.min}
                max={variable.number_options!.max}
                step={variable.number_options?.step ?? 1}
              />
              <span className="variable-control__slider-value">
                {localValue || variable.number_options!.min}
              </span>
            </div>
          ) : (
            <input
              type="number"
              className="variable-control__number"
              value={localValue}
              onChange={handleTextChange}
              placeholder="0"
              min={variable.number_options?.min}
              max={variable.number_options?.max}
              step={variable.number_options?.step ?? 1}
            />
          )
        )}
      </div>
    </div>
  );
};

interface VariablesViewProps {
  isActive?: boolean;
}

const VariablesView: React.FC<VariablesViewProps> = ({ isActive = true }) => {
  const { variables, isLoading, loadVariables, updateValue, isInitialized } = useVariableStore();

  // Load variables when becoming active (lazy loading)
  useEffect(() => {
    if (isActive && !isInitialized) {
      loadVariables();
    }
  }, [isActive, isInitialized, loadVariables]);

  const handleValueChange = useCallback(
    async (id: string, value: string | number | boolean | null) => {
      try {
        await updateValue(id, value);
      } catch (error) {
        console.error('Failed to update variable:', error);
      }
    },
    [updateValue]
  );

  return (
    <div className="activity-panel-variables-island">
      {isLoading ? (
        <div className="variable-dropdown__loading">Loading...</div>
      ) : variables.length === 0 ? (
        <div className="variable-dropdown__empty">
          <p>No variables defined.</p>
          <p className="variable-dropdown__empty-hint">
            Create variables in Settings &gt; Prompts &gt; Variables
          </p>
        </div>
      ) : (
        variables.map((variable) => (
          <VariableControl
            key={variable.id}
            variable={variable}
            onValueChange={handleValueChange}
          />
        ))
      )}
    </div>
  );
};

export default VariablesView;
