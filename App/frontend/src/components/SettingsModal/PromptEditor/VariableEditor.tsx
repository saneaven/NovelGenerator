import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useActivePresetId, useDeleteVariableMutation } from '../../../data/presets';
import type { PromptVariable, VariableCreate, VariableDefinitionUpdate, VariableType } from '../../../types/variables';
import { getVariableTypeLabel, isValidVariableName } from '../../../types/variables';
import { Trash, Copy, Plus, Close } from '../../icons';
import { IconButton } from '../../IconButton';
import { CustomSelect } from '../../ui/CustomSelect';
import EditorPanelHeader from './EditorPanelHeader';
import HeaderOverflowMenu from './HeaderOverflowMenu';
import { useSettingsToast } from '../SettingsToastContext';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import './VariableEditor.css';

export interface VariableDraftNumberOptions {
  min: string;
  max: string;
  step: string;
  input_type: 'input' | 'slider';
}

export interface VariableDraftFields {
  name: string;
  description: string;
  select_options: string[];
  number_options: VariableDraftNumberOptions;
  default_value: string;
  default_value_boolean: boolean;
}

export interface VariableDefinitionDraft {
  draftKey: string;
  variableId: string | null;
  isNew: boolean;
  varType: VariableType;
  original: VariableDraftFields;
  current: VariableDraftFields;
  persistedValue: string | number | boolean | null;
  dirty: boolean;
  error: string;
}

interface VariableEditorProps {
  draft: VariableDefinitionDraft | null;
  onDraftChange: (draft: VariableDefinitionDraft) => void;
  onDeleted?: (variableId: string) => void;
  onDiscardNew?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function emptyNumberOptions(): VariableDraftNumberOptions {
  return { min: '', max: '', step: '1', input_type: 'input' };
}

function emptyFields(): VariableDraftFields {
  return {
    name: '',
    description: '',
    select_options: [],
    number_options: emptyNumberOptions(),
    default_value: '',
    default_value_boolean: false,
  };
}

function snapshotForDraft(draft: VariableDefinitionDraft, data: VariableDraftFields): string {
  const base: Record<string, unknown> = {
    name: data.name,
    description: data.description,
    select_options: data.select_options,
  };
  if (draft.varType === 'number') {
    base.number_options = data.number_options;
  }
  if (draft.isNew) {
    base.default_value = data.default_value;
    base.default_value_boolean = data.default_value_boolean;
  }
  return JSON.stringify(base);
}

function validateDraft(next: VariableDefinitionDraft): string {
  const name = next.current.name.trim();
  if (!name) {
    return 'Name is required';
  }
  if (!isValidVariableName(name)) {
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
    if (next.isNew && next.current.default_value.trim()) {
      const parsed = parseFloat(next.current.default_value);
      if (Number.isNaN(parsed)) {
        return 'Default value must be a valid number';
      }
    }
  }

  if (next.varType === 'select' && next.isNew && next.current.default_value.trim()) {
    if (!next.current.select_options.includes(next.current.default_value.trim())) {
      return 'Default value must be one of the select options';
    }
  }

  return '';
}

export function computeVariableDraft(next: VariableDefinitionDraft): VariableDefinitionDraft {
  const error = validateDraft(next);
  const dirty = next.isNew || snapshotForDraft(next, next.current) !== snapshotForDraft(next, next.original);
  return { ...next, dirty, error };
}

function toDefaultValueText(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function buildNewVariableDraft(draftKey: string): VariableDefinitionDraft {
  const draft: VariableDefinitionDraft = {
    draftKey,
    variableId: null,
    isNew: true,
    varType: 'string',
    original: emptyFields(),
    current: emptyFields(),
    persistedValue: null,
    dirty: true,
    error: '',
  };
  return computeVariableDraft(draft);
}

export function hydrateVariableDraft(variable: PromptVariable, draftKey: string): VariableDefinitionDraft {
  const fields: VariableDraftFields = {
    name: variable.name,
    description: variable.description ?? '',
    select_options: variable.select_options ? [...variable.select_options] : [],
    number_options: {
      min: variable.number_options?.min !== undefined ? String(variable.number_options.min) : '',
      max: variable.number_options?.max !== undefined ? String(variable.number_options.max) : '',
      step: variable.number_options?.step !== undefined ? String(variable.number_options.step) : '',
      input_type: variable.number_options?.input_type ?? 'input',
    },
    default_value: toDefaultValueText(variable.value),
    default_value_boolean: Boolean(variable.value),
  };

  return computeVariableDraft({
    draftKey,
    variableId: variable.id,
    isNew: false,
    varType: variable.var_type,
    original: {
      ...fields,
      select_options: [...fields.select_options],
      number_options: { ...fields.number_options },
    },
    current: {
      ...fields,
      select_options: [...fields.select_options],
      number_options: { ...fields.number_options },
    },
    persistedValue: variable.value,
    dirty: false,
    error: '',
  });
}

export function buildVariableCreatePayload(draft: VariableDefinitionDraft): VariableCreate {
  if (!draft.isNew) {
    throw new Error('buildVariableCreatePayload requires a new draft');
  }

  let defaultValue: string | number | boolean | undefined;
  if (draft.varType === 'boolean') {
    defaultValue = draft.current.default_value_boolean;
  } else if (draft.current.default_value.trim()) {
    if (draft.varType === 'number') {
      defaultValue = parseFloat(draft.current.default_value);
    } else {
      defaultValue = draft.current.default_value.trim();
    }
  }

  return {
    name: draft.current.name.trim(),
    var_type: draft.varType,
    description: draft.current.description.trim() || undefined,
    select_options: draft.varType === 'select' ? draft.current.select_options : undefined,
    default_value: defaultValue,
    number_options: draft.varType === 'number'
      ? {
          min: draft.current.number_options.min.trim() ? parseFloat(draft.current.number_options.min) : undefined,
          max: draft.current.number_options.max.trim() ? parseFloat(draft.current.number_options.max) : undefined,
          step: draft.current.number_options.step.trim() ? parseFloat(draft.current.number_options.step) : 1,
          input_type: draft.current.number_options.input_type,
        }
      : undefined,
  };
}

export function buildVariableDefinitionUpdate(draft: VariableDefinitionDraft): VariableDefinitionUpdate {
  return {
    name: draft.current.name.trim(),
    description: draft.current.description.trim(),
    select_options: draft.varType === 'select' ? draft.current.select_options : undefined,
    number_options: draft.varType === 'number'
      ? {
          min: draft.current.number_options.min.trim() ? parseFloat(draft.current.number_options.min) : undefined,
          max: draft.current.number_options.max.trim() ? parseFloat(draft.current.number_options.max) : undefined,
          step: draft.current.number_options.step.trim() ? parseFloat(draft.current.number_options.step) : undefined,
          input_type: draft.current.number_options.input_type,
        }
      : undefined,
  };
}

const VARIABLE_TYPE_OPTIONS: Array<{ value: VariableType; label: string; description: string }> = [
  { value: 'string', label: 'Text', description: 'Free-form string value' },
  { value: 'number', label: 'Number', description: 'Numeric value with optional range' },
  { value: 'boolean', label: 'Toggle', description: 'True or false switch' },
  { value: 'select', label: 'Dropdown', description: 'Choose from predefined options' },
];

const VariableEditor: React.FC<VariableEditorProps> = ({
  draft,
  onDraftChange,
  onDeleted,
  onDiscardNew,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const toast = useSettingsToast();
  const activePresetId = useActivePresetId();
  const deleteVariable = useDeleteVariableMutation(activePresetId);
  const [newOption, setNewOption] = useState('');

  useEffect(() => {
    setNewOption('');
  }, [draft?.draftKey]);

  const canUseSlider = useMemo(() => {
    if (!draft) return false;
    return draft.current.number_options.min !== '' && draft.current.number_options.max !== '';
  }, [draft]);

  const updateDraft = (updater: (current: VariableDefinitionDraft) => VariableDefinitionDraft) => {
    if (!draft) return;
    onDraftChange(computeVariableDraft(updater(draft)));
  };

  if (!draft) {
    return (
      <div className="variable-editor variable-editor--empty">
        {onToggleSidebar && (
          <EditorPanelHeader
            title="Variables"
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={onToggleSidebar}
          />
        )}
        <div className="variable-editor__empty-state">
          <p>Select a variable to edit</p>
          <p className="variable-editor__empty-hint">Or create a new variable using the button below</p>
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
    updateDraft((currentDraft) => ({
      ...currentDraft,
      current: {
        ...currentDraft.current,
        select_options: [...currentDraft.current.select_options, trimmed],
      },
    }));
    setNewOption('');
  };

  const handleRemoveOption = (index: number) => {
    updateDraft((currentDraft) => ({
      ...currentDraft,
      current: {
        ...currentDraft.current,
        select_options: currentDraft.current.select_options.filter((_, i) => i !== index),
      },
    }));
  };

  const handleDelete = async () => {
    if (draft.isNew || !draft.variableId) {
      onDiscardNew?.();
      return;
    }

    const confirmed = await confirm({
      title: 'Delete Variable',
      message: `Delete variable "${draft.current.name}"? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    try {
      await deleteVariable.mutateAsync(draft.variableId);
      onDeleted?.(draft.variableId);
    } catch (err) {
      await showAlert({
        title: 'Delete Failed',
        message: err instanceof Error ? err.message : 'Failed to delete',
        variant: 'danger',
      });
    }
  };

  const handleCopyUsage = async () => {
    const usage = `{{variables.${draft.current.name || 'name'}}}`;
    try {
      await navigator.clipboard.writeText(usage);
      toast.success(t('common.copied', { value: usage }));
    } catch {
      toast.error(t('settings.promptEditor.toast.copyFailed'));
    }
  };

  return (
    <div className="variable-editor">
      <EditorPanelHeader
        title={draft.current.name || (draft.isNew ? 'New Variable' : 'Variables')}
        badge={
          <span className="variable-editor__type-badge">
            {getVariableTypeLabel(draft.varType)}
          </span>
        }
        actions={
          <HeaderOverflowMenu
            items={[
              {
                key: draft.isNew ? 'discard-variable' : 'delete-variable',
                icon: <Trash size="sm" />,
                label: draft.isNew ? 'Discard' : t('common.delete'),
                onClick: handleDelete,
                variant: 'danger',
              },
            ]}
          />
        }
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />

      <div className="variable-editor__content">
        <div className="variable-editor__usage-hint">
          <span className="variable-editor__usage-label">Usage:</span>
          <code className="variable-editor__usage-code">
            {'{{variables.'}{draft.current.name || 'name'}{'}}'}
          </code>
          <IconButton
            icon={<Copy size="sm" />}
            onClick={handleCopyUsage}
            title="Copy"
            size="sm"
            variant="ghost"
          />
        </div>

        {draft.isNew && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Type</label>
            <div className="variable-editor__type-grid">
              {VARIABLE_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`variable-editor__type-btn ${draft.varType === option.value ? 'active' : ''}`}
                  onClick={() => updateDraft((currentDraft) => ({
                    ...currentDraft,
                    varType: option.value,
                    current: {
                      ...currentDraft.current,
                      select_options: option.value === 'select' ? currentDraft.current.select_options : [],
                      number_options: option.value === 'number' ? currentDraft.current.number_options : emptyNumberOptions(),
                      default_value: option.value === 'boolean' ? '' : currentDraft.current.default_value,
                    },
                  }))}
                >
                  <span className="variable-editor__type-label">{option.label}</span>
                  <span className="variable-editor__type-desc">{option.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="variable-editor__field">
          <label className="variable-editor__label">Name</label>
          <input
            type="text"
            className="variable-editor__input"
            value={currentName}
            onChange={(event) => updateDraft((currentDraft) => ({
              ...currentDraft,
              current: { ...currentDraft.current, name: event.target.value },
            }))}
            placeholder="variableName"
          />
        </div>

        <div className="variable-editor__field">
          <label className="variable-editor__label">Description (optional)</label>
          <textarea
            className="variable-editor__textarea"
            value={currentDescription}
            onChange={(event) => updateDraft((currentDraft) => ({
              ...currentDraft,
              current: { ...currentDraft.current, description: event.target.value },
            }))}
            placeholder="Describe what this variable is for..."
            rows={2}
          />
        </div>

        {draft.varType === 'select' && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Options</label>
            <div className="variable-editor__options">
              {currentOptions.map((option, index) => (
                <div key={`${option}-${index}`} className="variable-editor__option">
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
                  onChange={(event) => setNewOption(event.target.value)}
                  placeholder="Add option..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
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

        {draft.varType === 'number' && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Number Options</label>
            <div className="variable-editor__number-options">
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Min</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={currentNumberOptions.min}
                  onChange={(event) => updateDraft((currentDraft) => {
                    const nextValue = event.target.value;
                    const nextInputType =
                      currentDraft.current.number_options.input_type === 'slider'
                      && (!nextValue || !currentDraft.current.number_options.max)
                        ? 'input'
                        : currentDraft.current.number_options.input_type;
                    return {
                      ...currentDraft,
                      current: {
                        ...currentDraft.current,
                        number_options: {
                          ...currentDraft.current.number_options,
                          min: nextValue,
                          input_type: nextInputType,
                        },
                      },
                    };
                  })}
                  placeholder="No limit"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Max</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={currentNumberOptions.max}
                  onChange={(event) => updateDraft((currentDraft) => {
                    const nextValue = event.target.value;
                    const nextInputType =
                      currentDraft.current.number_options.input_type === 'slider'
                      && (!currentDraft.current.number_options.min || !nextValue)
                        ? 'input'
                        : currentDraft.current.number_options.input_type;
                    return {
                      ...currentDraft,
                      current: {
                        ...currentDraft.current,
                        number_options: {
                          ...currentDraft.current.number_options,
                          max: nextValue,
                          input_type: nextInputType,
                        },
                      },
                    };
                  })}
                  placeholder="No limit"
                />
              </div>
              <div className="variable-editor__number-row">
                <label className="variable-editor__number-label">Step</label>
                <input
                  type="number"
                  className="variable-editor__number-input"
                  value={currentNumberOptions.step}
                  onChange={(event) => updateDraft((currentDraft) => ({
                    ...currentDraft,
                    current: {
                      ...currentDraft.current,
                      number_options: {
                        ...currentDraft.current.number_options,
                        step: event.target.value,
                      },
                    },
                  }))}
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
                  onChange={(value) => updateDraft((currentDraft) => ({
                    ...currentDraft,
                    current: {
                      ...currentDraft.current,
                      number_options: {
                        ...currentDraft.current.number_options,
                        input_type: value as 'input' | 'slider',
                      },
                    },
                  }))}
                  options={[
                    { value: 'input', label: 'Input Field' },
                    { value: 'slider', label: 'Slider', disabled: !canUseSlider },
                  ]}
                />
              </div>
              {!canUseSlider && (
                <p className="variable-editor__hint">Slider requires both min and max values</p>
              )}
            </div>
          </div>
        )}

        {draft.isNew && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Default Value</label>
            {draft.varType === 'boolean' ? (
              <CustomSelect
                className="variable-editor__select"
                value={draft.current.default_value_boolean ? 'true' : 'false'}
                onChange={(value) => updateDraft((currentDraft) => ({
                  ...currentDraft,
                  current: {
                    ...currentDraft.current,
                    default_value_boolean: value === 'true',
                  },
                }))}
                options={[
                  { value: 'false', label: 'false' },
                  { value: 'true', label: 'true' },
                ]}
              />
            ) : draft.varType === 'select' ? (
              <CustomSelect
                className="variable-editor__select"
                value={draft.current.default_value}
                onChange={(value) => updateDraft((currentDraft) => ({
                  ...currentDraft,
                  current: {
                    ...currentDraft.current,
                    default_value: String(value ?? ''),
                  },
                }))}
                options={draft.current.select_options.map((option) => ({ value: option, label: option }))}
                placeholder="Select"
              />
            ) : (
              <input
                type={draft.varType === 'number' ? 'number' : 'text'}
                className="variable-editor__input"
                value={draft.current.default_value}
                onChange={(event) => updateDraft((currentDraft) => ({
                  ...currentDraft,
                  current: {
                    ...currentDraft.current,
                    default_value: event.target.value,
                  },
                }))}
                placeholder={draft.varType === 'number' ? '0' : 'Enter default value'}
              />
            )}
          </div>
        )}

        {!draft.isNew && (
          <div className="variable-editor__field">
            <label className="variable-editor__label">Current Value</label>
            <div className="variable-editor__current-value">
              {draft.persistedValue === null ? (
                <span className="variable-editor__null-value">null</span>
              ) : draft.varType === 'boolean' ? (
                <span className={`variable-editor__boolean-value ${draft.persistedValue ? 'true' : 'false'}`}>
                  {draft.persistedValue ? 'true' : 'false'}
                </span>
              ) : (
                <span>{String(draft.persistedValue)}</span>
              )}
            </div>
            <p className="variable-editor__hint">
              Change the value using the Variables dropdown in the workspace header.
            </p>
          </div>
        )}

        {draft.error && <div className="variable-editor__error">{draft.error}</div>}
      </div>
    </div>
  );
};

export default VariableEditor;
