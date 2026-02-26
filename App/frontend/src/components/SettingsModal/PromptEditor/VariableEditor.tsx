import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVariableStore } from '../../../store/variableStore';
import type { VariableType } from '../../../types/variables';
import { getVariableTypeLabel, isValidVariableName } from '../../../types/variables';
import { Trash, Copy, Plus, Close, ChevronLeft, ChevronRight } from '../../icons';
import { TextButton } from '../../TextButton';
import { IconButton } from '../../IconButton';
import { CustomSelect } from '../../ui/CustomSelect';
import { useSettingsToast } from '../SettingsToastContext';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import './VariableEditor.css';

export interface VariableDefinitionDraft {
  variableId: string;
  varType: VariableType;
  original: {
    name: string;
    description: string;
    select_options: string[];
    number_options: { min: string; max: string; step: string; input_type: 'input' | 'slider' };
  };
  current: {
    name: string;
    description: string;
    select_options: string[];
    number_options: { min: string; max: string; step: string; input_type: 'input' | 'slider' };
  };
  dirty: boolean;
  error: string;
}

interface VariableEditorProps {
  variableId: string | null;
  draft: VariableDefinitionDraft | null;
  onDraftChange: (draft: VariableDefinitionDraft) => void;
  onDeleted?: (variableId: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function snapshotForDraft(varType: VariableType, data: VariableDefinitionDraft['current']): string {
  const base: any = {
    name: data.name,
    description: data.description,
    select_options: data.select_options,
  };
  if (varType === 'number') {
    base.number_options = data.number_options;
  }
  return JSON.stringify(base);
}

function computeDraft(next: VariableDefinitionDraft): VariableDefinitionDraft {
  const error = (() => {
    const name = next.current.name;
    if (!name.trim()) {
      return 'Name is required';
    }
    if (name && !isValidVariableName(name)) {
      return 'Name must start with a letter and contain only letters, numbers, and underscores';
    }

    if (next.varType === 'select' && next.current.select_options.length < 2) {
      return 'Select type requires at least 2 options';
    }

    if (next.varType === 'number') {
      const minVal = next.current.number_options.min !== '' ? parseFloat(next.current.number_options.min) : undefined;
      const maxVal = next.current.number_options.max !== '' ? parseFloat(next.current.number_options.max) : undefined;
      if (minVal !== undefined && maxVal !== undefined && minVal >= maxVal) {
        return 'Min must be less than max';
      }
      if (next.current.number_options.input_type === 'slider' && (minVal === undefined || maxVal === undefined)) {
        return 'Slider requires both min and max values';
      }
    }

    return '';
  })();

  const dirty = snapshotForDraft(next.varType, next.current) !== snapshotForDraft(next.varType, next.original);
  return { ...next, dirty, error };
}

const VariableEditor: React.FC<VariableEditorProps> = ({
  variableId,
  draft,
  onDraftChange,
  onDeleted,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const toast = useSettingsToast();
  const { variables, deleteVariable } = useVariableStore();
  const variable = variables.find((v) => v.id === variableId);
  const [newOption, setNewOption] = useState('');

  useEffect(() => {
    setNewOption('');
  }, [variableId]);

  const canUseSlider = useMemo(() => {
    if (!draft) return false;
    return draft.current.number_options.min !== '' && draft.current.number_options.max !== '';
  }, [draft]);

  if (!variable || !draft) {
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

  const currentName = draft.current.name;
  const currentDescription = draft.current.description;
  const currentOptions = draft.current.select_options;
  const currentNumberOptions = draft.current.number_options;

  const handleAddOption = () => {
    const trimmed = newOption.trim();
    if (!trimmed || currentOptions.includes(trimmed)) return;

    onDraftChange(
      computeDraft({
        ...draft,
        current: {
          ...draft.current,
          select_options: [...currentOptions, trimmed],
        },
      })
    );
    setNewOption('');
  };

  const handleRemoveOption = (index: number) => {
    const newOptions = currentOptions.filter((_, i) => i !== index);
    onDraftChange(
      computeDraft({
        ...draft,
        current: {
          ...draft.current,
          select_options: newOptions,
        },
      })
    );
  };

  // Number options handlers
  const handleMinChange = (value: string) => {
    const nextInputType =
      currentNumberOptions.input_type === 'slider' && (!value || !currentNumberOptions.max) ? 'input' : currentNumberOptions.input_type;
    onDraftChange(
      computeDraft({
        ...draft,
        current: {
          ...draft.current,
          number_options: {
            ...currentNumberOptions,
            min: value,
            input_type: nextInputType,
          },
        },
      })
    );
  };

  const handleMaxChange = (value: string) => {
    const nextInputType =
      currentNumberOptions.input_type === 'slider' && (!currentNumberOptions.min || !value) ? 'input' : currentNumberOptions.input_type;
    onDraftChange(
      computeDraft({
        ...draft,
        current: {
          ...draft.current,
          number_options: {
            ...currentNumberOptions,
            max: value,
            input_type: nextInputType,
          },
        },
      })
    );
  };

  const handleStepChange = (value: string) => {
    onDraftChange(
      computeDraft({
        ...draft,
        current: {
          ...draft.current,
          number_options: {
            ...currentNumberOptions,
            step: value,
          },
        },
      })
    );
  };

  const handleInputTypeChange = (value: 'input' | 'slider') => {
    onDraftChange(
      computeDraft({
        ...draft,
        current: {
          ...draft.current,
          number_options: {
            ...currentNumberOptions,
            input_type: value,
          },
        },
      })
    );
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Variable',
      message: `Delete variable "${variable.name}"? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    try {
      await deleteVariable(variable.id);
      onDeleted?.(variable.id);
    } catch (err) {
      await showAlert({
        title: 'Delete Failed',
        message: err instanceof Error ? err.message : 'Failed to delete',
        variant: 'danger',
      });
    }
  };

  const handleCopyUsage = async () => {
    const usage = `{{variables.${draft.current.name}}}`;
    try {
      await navigator.clipboard.writeText(usage);
      toast.success(t('common.copied', { value: usage }));
    } catch {
      toast.error(t('settings.promptEditor.toast.copyFailed'));
    }
  };

  return (
    <div className="variable-editor">
      <div className="variable-editor__header">
        <div className="variable-editor__title-row">
          <h3 className="variable-editor__title">{draft.current.name}</h3>
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
            {'{{variables.'}{draft.current.name}{'}}'}
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
            value={currentName}
            onChange={(e) => onDraftChange(computeDraft({ ...draft, current: { ...draft.current, name: e.target.value } }))}
            placeholder="variableName"
          />
        </div>

        {/* Description field */}
        <div className="variable-editor__field">
          <label className="variable-editor__label">Description (optional)</label>
          <textarea
            className="variable-editor__textarea"
            value={currentDescription}
            onChange={(e) =>
              onDraftChange(computeDraft({ ...draft, current: { ...draft.current, description: e.target.value } }))
            }
            placeholder="Describe what this variable is for..."
            rows={2}
          />
        </div>

        {/* Select options (only for select type) */}
        {variable.var_type === 'select' && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Options</label>
            <div className="variable-editor__options">
              {currentOptions.map((option, index) => (
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
                  value={currentNumberOptions.min}
                  onChange={(e) => handleMinChange(e.target.value)}
                  placeholder="No limit"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Max</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={currentNumberOptions.max}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  placeholder="No limit"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Step</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={currentNumberOptions.step}
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
                  value={currentNumberOptions.input_type}
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
        {draft.error && (
          <div className="variable-editor__error">{draft.error}</div>
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
      </div>
    </div>
  );
};

export default VariableEditor;
