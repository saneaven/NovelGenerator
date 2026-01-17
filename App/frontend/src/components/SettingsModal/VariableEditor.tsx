import React, { useState, useEffect } from 'react';
import { useVariableStore } from '../../store/variableStore';
import type { NumberOptions } from '../../types/variables';
import { getVariableTypeLabel, isValidVariableName } from '../../types/variables';
import { Trash, Copy, Plus, Close, ChevronLeft, ChevronRight } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { CustomSelect } from '../ui/CustomSelect';
import './VariableEditor.css';

interface VariableEditorProps {
  variableId: string | null;
  onDelete?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const VariableEditor: React.FC<VariableEditorProps> = ({
  variableId,
  onDelete,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { variables, updateDefinition, deleteVariable } = useVariableStore();
  const variable = variables.find((v) => v.id === variableId);

  const [editedName, setEditedName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedOptions, setEditedOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Number options state
  const [editedMin, setEditedMin] = useState<string>('');
  const [editedMax, setEditedMax] = useState<string>('');
  const [editedStep, setEditedStep] = useState<string>('1');
  const [editedInputType, setEditedInputType] = useState<'input' | 'slider'>('input');

  // Reset form when selecting a different variable
  useEffect(() => {
    const currentVariable = variables.find((v) => v.id === variableId);
    if (currentVariable) {
      setEditedName(currentVariable.name);
      setEditedDescription(currentVariable.description || '');
      setEditedOptions(currentVariable.select_options || []);
      // Reset number options
      const numOpts = currentVariable.number_options;
      setEditedMin(numOpts?.min !== undefined ? String(numOpts.min) : '');
      setEditedMax(numOpts?.max !== undefined ? String(numOpts.max) : '');
      setEditedStep(numOpts?.step !== undefined ? String(numOpts.step) : '1');
      setEditedInputType(numOpts?.input_type || 'input');
      setHasChanges(false);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableId]);

  const handleNameChange = (value: string) => {
    setEditedName(value);
    setHasChanges(true);
    if (value && !isValidVariableName(value)) {
      setError('Name must start with a letter and contain only letters, numbers, and underscores');
    } else {
      setError('');
    }
  };

  const handleDescriptionChange = (value: string) => {
    setEditedDescription(value);
    setHasChanges(true);
    setError('');
  };

  const handleAddOption = () => {
    const trimmed = newOption.trim();
    if (trimmed && !editedOptions.includes(trimmed)) {
      setEditedOptions([...editedOptions, trimmed]);
      setNewOption('');
      setHasChanges(true);
      setError('');
    }
  };

  const handleRemoveOption = (index: number) => {
    const newOptions = editedOptions.filter((_, i) => i !== index);
    setEditedOptions(newOptions);
    setHasChanges(true);
    setError('');
  };

  // Number options handlers
  const handleMinChange = (value: string) => {
    setEditedMin(value);
    setHasChanges(true);
    setError('');
    // If switching to slider and min/max not both set, reset to input
    if (editedInputType === 'slider' && (!value || !editedMax)) {
      setEditedInputType('input');
    }
  };

  const handleMaxChange = (value: string) => {
    setEditedMax(value);
    setHasChanges(true);
    setError('');
    // If switching to slider and min/max not both set, reset to input
    if (editedInputType === 'slider' && (!editedMin || !value)) {
      setEditedInputType('input');
    }
  };

  const handleStepChange = (value: string) => {
    setEditedStep(value);
    setHasChanges(true);
    setError('');
  };

  const handleInputTypeChange = (value: 'input' | 'slider') => {
    setEditedInputType(value);
    setHasChanges(true);
    setError('');
  };

  // Check if slider can be enabled
  const canUseSlider = editedMin !== '' && editedMax !== '';

  const handleSave = async () => {
    if (!variable) return;

    if (editedName && !isValidVariableName(editedName)) {
      setError('Invalid variable name');
      return;
    }

    if (variable.var_type === 'select' && editedOptions.length < 2) {
      setError('Select type requires at least 2 options');
      return;
    }

    // Validate number options
    if (variable.var_type === 'number') {
      const minVal = editedMin !== '' ? parseFloat(editedMin) : undefined;
      const maxVal = editedMax !== '' ? parseFloat(editedMax) : undefined;
      if (minVal !== undefined && maxVal !== undefined && minVal >= maxVal) {
        setError('Min must be less than max');
        return;
      }
      if (editedInputType === 'slider' && (minVal === undefined || maxVal === undefined)) {
        setError('Slider requires both min and max values');
        return;
      }
    }

    setIsSaving(true);
    setError('');

    try {
      // Build number_options if this is a number type
      let numberOptions: NumberOptions | undefined;
      if (variable.var_type === 'number') {
        numberOptions = {
          min: editedMin !== '' ? parseFloat(editedMin) : undefined,
          max: editedMax !== '' ? parseFloat(editedMax) : undefined,
          step: editedStep !== '' ? parseFloat(editedStep) : 1,
          input_type: editedInputType,
        };
      }

      await updateDefinition(variable.id, {
        name: editedName !== variable.name ? editedName : undefined,
        description: editedDescription || undefined,
        select_options: variable.var_type === 'select' ? editedOptions : undefined,
        number_options: numberOptions,
      });
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!variable) return;

    const confirmed = window.confirm(`Delete variable "${variable.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteVariable(variable.id);
      onDelete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleCopyUsage = () => {
    if (!variable) return;
    navigator.clipboard.writeText(`{{variables.${variable.name}}}`);
  };

  if (!variable) {
    return (
      <div className="variable-editor variable-editor--empty">
        {onToggleSidebar && (
          <div className="variable-editor__header variable-editor__header--empty">
            <div className="variable-editor__title-row">
              <h3 className="variable-editor__title">Variables</h3>
            </div>
            <div className="variable-editor__actions">
              <IconButton
                icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
                onClick={onToggleSidebar}
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                size="sm"
              />
            </div>
          </div>
        )}
        <div className="variable-editor__empty-state">
          <p>Select a variable to edit</p>
          <p className="variable-editor__empty-hint">
            Or create a new variable using the button below
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="variable-editor">
      <div className="variable-editor__header">
        <div className="variable-editor__title-row">
          <h3 className="variable-editor__title">{variable.name}</h3>
          <span className="variable-editor__type-badge">
            {getVariableTypeLabel(variable.var_type)}
          </span>
        </div>
        <div className="variable-editor__actions">
          {onToggleSidebar && (
            <IconButton
              icon={isSidebarCollapsed ? <ChevronLeft size="sm" /> : <ChevronRight size="sm" />}
              onClick={onToggleSidebar}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              size="sm"
            />
          )}
        </div>
      </div>

      <div className="variable-editor__content">
        {/* Usage hint */}
        <div className="variable-editor__usage-hint">
          <span className="variable-editor__usage-label">Usage:</span>
          <code className="variable-editor__usage-code">
            {'{{variables.'}{variable.name}{'}}'}
          </code>
          <IconButton
            icon={<Copy size="sm" />}
            onClick={handleCopyUsage}
            title="Copy"
            size="sm"
            variant="ghost"
          />
        </div>

        {/* Name field */}
        <div className="variable-editor__field">
          <label className="variable-editor__label">Name</label>
          <input
            type="text"
            className="variable-editor__input"
            value={editedName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="variableName"
          />
        </div>

        {/* Description field */}
        <div className="variable-editor__field">
          <label className="variable-editor__label">Description (optional)</label>
          <textarea
            className="variable-editor__textarea"
            value={editedDescription}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Describe what this variable is for..."
            rows={2}
          />
        </div>

        {/* Select options (only for select type) */}
        {variable.var_type === 'select' && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Options</label>
            <div className="variable-editor__options">
              {editedOptions.map((option, index) => (
                <div key={index} className="variable-editor__option">
                  <span className="variable-editor__option-text">{option}</span>
                  <button
                    className="variable-editor__option-remove"
                    onClick={() => handleRemoveOption(index)}
                    title="Remove option"
                  >
                    <Close size="xs" />
                  </button>
                </div>
              ))}
              <div className="variable-editor__option-add">
                <input
                  type="text"
                  className="variable-editor__option-input"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="Add option..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddOption();
                    }
                  }}
                />
                <button
                  className="variable-editor__option-add-btn"
                  onClick={handleAddOption}
                  disabled={!newOption.trim()}
                >
                  <Plus size="sm" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Number options (only for number type) */}
        {variable.var_type === 'number' && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Number Options</label>
            <div className="variable-editor__number-options">
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Min</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={editedMin}
                  onChange={(e) => handleMinChange(e.target.value)}
                  placeholder="No limit"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Max</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={editedMax}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  placeholder="No limit"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Step</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={editedStep}
                  onChange={(e) => handleStepChange(e.target.value)}
                  placeholder="1"
                  min="0.001"
                  step="any"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Display as</label>
                <CustomSelect
                  className="variable-editor__number-select"
                  value={editedInputType}
                  onChange={(value) => handleInputTypeChange(value as 'input' | 'slider')}
                  options={[
                    { value: 'input', label: 'Input Field' },
                    { value: 'slider', label: 'Slider', disabled: !canUseSlider },
                  ]}
                />
              </div>
              {!canUseSlider && (
                <p className="variable-editor__hint">
                  Slider requires both min and max values
                </p>
              )}
            </div>
          </div>
        )}

        {/* Current value display */}
        <div className="variable-editor__field">
          <label className="variable-editor__label">Current Value</label>
          <div className="variable-editor__current-value">
            {variable.value === null ? (
              <span className="variable-editor__null-value">null</span>
            ) : variable.var_type === 'boolean' ? (
              <span className={`variable-editor__boolean-value ${variable.value ? 'true' : 'false'}`}>
                {variable.value ? 'true' : 'false'}
              </span>
            ) : (
              <span>{String(variable.value)}</span>
            )}
          </div>
          <p className="variable-editor__hint">
            Change the value using the Variables dropdown in the workspace header.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="variable-editor__error">{error}</div>
        )}
      </div>

      {/* Footer */}
      <div className="variable-editor__footer">
        <TextButton
          iconLeft={<Trash size="sm" />}
          onClick={handleDelete}
          variant="danger"
        >
          Delete
        </TextButton>
        {hasChanges && (
          <TextButton
            onClick={handleSave}
            disabled={isSaving || !!error}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </TextButton>
        )}
      </div>
    </div>
  );
};

export default VariableEditor;
