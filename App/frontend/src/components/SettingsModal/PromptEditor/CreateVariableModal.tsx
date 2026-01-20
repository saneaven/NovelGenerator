import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../../BaseModal';
import { useVariableStore } from '../../../store/variableStore';
import type { VariableType, VariableCreate, NumberOptions } from '../../../types/variables';
import { isValidVariableName } from '../../../types/variables';
import { Plus, Close } from '../../icons';
import { CustomSelect } from '../../ui/CustomSelect';
import './CreateVariableModal.css';

interface CreateVariableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (id: string) => void;
}

const CreateVariableModal: React.FC<CreateVariableModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const { t } = useTranslation();
  const { createVariable } = useVariableStore();

  const VARIABLE_TYPES: { value: VariableType; label: string; description: string }[] = [
    { value: 'string', label: t('settings.promptEditor.createVariable.typeText'), description: t('settings.promptEditor.createVariable.typeTextDesc') },
    { value: 'number', label: t('settings.promptEditor.createVariable.typeNumber'), description: t('settings.promptEditor.createVariable.typeNumberDesc') },
    { value: 'boolean', label: t('settings.promptEditor.createVariable.typeToggle'), description: t('settings.promptEditor.createVariable.typeToggleDesc') },
    { value: 'select', label: t('settings.promptEditor.createVariable.typeDropdown'), description: t('settings.promptEditor.createVariable.typeDropdownDesc') },
  ];

  const [name, setName] = useState('');
  const [varType, setVarType] = useState<VariableType>('string');
  const [description, setDescription] = useState('');
  const [defaultValue, setDefaultValue] = useState<string>('');
  const [selectOptions, setSelectOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  // Number options state
  const [numMin, setNumMin] = useState<string>('');
  const [numMax, setNumMax] = useState<string>('');
  const [numStep, setNumStep] = useState<string>('1');
  const [numInputType, setNumInputType] = useState<'input' | 'slider'>('input');

  const resetForm = () => {
    setName('');
    setVarType('string');
    setDescription('');
    setDefaultValue('');
    setSelectOptions([]);
    setNewOption('');
    setNumMin('');
    setNumMax('');
    setNumStep('1');
    setNumInputType('input');
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleTypeChange = (type: VariableType) => {
    setVarType(type);
    setDefaultValue('');
    setSelectOptions([]);
    setNumMin('');
    setNumMax('');
    setNumStep('1');
    setNumInputType('input');
    setError('');
  };

  // Check if slider can be enabled
  const canUseSlider = numMin !== '' && numMax !== '';

  const handleAddOption = () => {
    const trimmed = newOption.trim();
    if (trimmed && !selectOptions.includes(trimmed)) {
      setSelectOptions([...selectOptions, trimmed]);
      setNewOption('');
    }
  };

  const handleRemoveOption = (index: number) => {
    setSelectOptions(selectOptions.filter((_, i) => i !== index));
  };

  const handleCreate = async () => {
    // Validation
    if (!name.trim()) {
      setError(t('settings.promptEditor.createVariable.nameRequired'));
      return;
    }

    if (!isValidVariableName(name)) {
      setError(t('settings.promptEditor.createVariable.invalidName'));
      return;
    }

    if (varType === 'select' && selectOptions.length < 2) {
      setError(t('settings.promptEditor.createVariable.dropdownMinOptions'));
      return;
    }

    // Validate number options
    if (varType === 'number') {
      const minVal = numMin !== '' ? parseFloat(numMin) : undefined;
      const maxVal = numMax !== '' ? parseFloat(numMax) : undefined;
      if (minVal !== undefined && maxVal !== undefined && minVal >= maxVal) {
        setError(t('settings.promptEditor.createVariable.minLessThanMax'));
        return;
      }
      if (numInputType === 'slider' && (minVal === undefined || maxVal === undefined)) {
        setError(t('settings.promptEditor.createVariable.sliderMinMaxRequired'));
        return;
      }
    }

    setIsCreating(true);
    setError('');

    try {
      // Parse default value based on type
      let parsedDefaultValue: string | number | boolean | undefined;

      if (defaultValue) {
        switch (varType) {
          case 'string':
            parsedDefaultValue = defaultValue;
            break;
          case 'number':
            parsedDefaultValue = parseFloat(defaultValue);
            if (isNaN(parsedDefaultValue)) {
              setError(t('settings.promptEditor.createVariable.invalidNumber'));
              setIsCreating(false);
              return;
            }
            break;
          case 'boolean':
            parsedDefaultValue = defaultValue === 'true';
            break;
          case 'select':
            parsedDefaultValue = defaultValue;
            break;
        }
      }

      // Build number_options if this is a number type
      let numberOptions: NumberOptions | undefined;
      if (varType === 'number') {
        numberOptions = {
          min: numMin !== '' ? parseFloat(numMin) : undefined,
          max: numMax !== '' ? parseFloat(numMax) : undefined,
          step: numStep !== '' ? parseFloat(numStep) : 1,
          input_type: numInputType,
        };
      }

      const data: VariableCreate = {
        name: name.trim(),
        var_type: varType,
        description: description.trim() || undefined,
        select_options: varType === 'select' ? selectOptions : undefined,
        default_value: parsedDefaultValue,
        number_options: numberOptions,
      };

      const newVariable = await createVariable(data);
      onCreate(newVariable.id);
      handleClose();
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already exists')) {
        setError(t('settings.promptEditor.createVariable.duplicateName'));
      } else {
        setError(err.message || t('settings.promptEditor.createVariable.createFailed'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.promptEditor.createVariable.title')}
      size="medium"
    >
      <div className="create-variable-modal">
        {/* Name field */}
        <div className="create-variable-modal__field">
          <label className="create-variable-modal__label">
            {t('settings.promptEditor.createVariable.name')} <span className="create-variable-modal__required">*</span>
          </label>
          <input
            type="text"
            className="create-variable-modal__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.promptEditor.createVariable.namePlaceholder')}
            autoFocus
          />
          <p className="create-variable-modal__hint">
            {t('settings.promptEditor.createVariable.nameHint').replace('{{name}}', name || 'name')}
          </p>
        </div>

        {/* Type selection */}
        <div className="create-variable-modal__field">
          <label className="create-variable-modal__label">
            {t('settings.promptEditor.createVariable.type')} <span className="create-variable-modal__required">*</span>
          </label>
          <div className="create-variable-modal__type-grid">
            {VARIABLE_TYPES.map((type) => (
              <button
                key={type.value}
                className={`create-variable-modal__type-btn ${varType === type.value ? 'active' : ''}`}
                onClick={() => handleTypeChange(type.value)}
                type="button"
              >
                <span className="create-variable-modal__type-label">{type.label}</span>
                <span className="create-variable-modal__type-desc">{type.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Description field */}
        <div className="create-variable-modal__field">
          <label className="create-variable-modal__label">{t('settings.promptEditor.createVariable.description')}</label>
          <textarea
            className="create-variable-modal__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('settings.promptEditor.createVariable.descriptionPlaceholder')}
            rows={2}
          />
        </div>

        {/* Select options (only for select type) */}
        {varType === 'select' && (
          <div className="create-variable-modal__field">
            <label className="create-variable-modal__label">
              {t('settings.promptEditor.createVariable.options')} <span className="create-variable-modal__required">*</span>
            </label>
            <div className="create-variable-modal__options">
              {selectOptions.map((option, index) => (
                <div key={index} className="create-variable-modal__option">
                  <span className="create-variable-modal__option-text">{option}</span>
                  <button
                    className="create-variable-modal__option-remove"
                    onClick={() => handleRemoveOption(index)}
                    type="button"
                  >
                    <Close size="xs" />
                  </button>
                </div>
              ))}
              <div className="create-variable-modal__option-add">
                <input
                  type="text"
                  className="create-variable-modal__option-input"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder={t('settings.promptEditor.createVariable.addOption')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddOption();
                    }
                  }}
                />
                <button
                  className="create-variable-modal__option-add-btn"
                  onClick={handleAddOption}
                  disabled={!newOption.trim()}
                  type="button"
                >
                  <Plus size="sm" />
                </button>
              </div>
            </div>
            <p className="create-variable-modal__hint">
              {t('settings.promptEditor.createVariable.optionsHint')}
            </p>
          </div>
        )}

        {/* Number options (only for number type) */}
        {varType === 'number' && (
          <div className="create-variable-modal__field">
            <label className="create-variable-modal__label">{t('settings.promptEditor.createVariable.numberOptions')}</label>
            <div className="create-variable-modal__number-options">
              <div className="create-variable-modal__number-row">
                <label className="create-variable-modal__number-label">{t('settings.promptEditor.createVariable.min')}</label>
                <input
                  type="number"
                  className="create-variable-modal__number-input"
                  value={numMin}
                  onChange={(e) => {
                    setNumMin(e.target.value);
                    // Reset to input if slider and min/max not both set
                    if (numInputType === 'slider' && (!e.target.value || !numMax)) {
                      setNumInputType('input');
                    }
                  }}
                  placeholder={t('settings.promptEditor.createVariable.noLimit')}
                />
              </div>
              <div className="create-variable-modal__number-row">
                <label className="create-variable-modal__number-label">{t('settings.promptEditor.createVariable.max')}</label>
                <input
                  type="number"
                  className="create-variable-modal__number-input"
                  value={numMax}
                  onChange={(e) => {
                    setNumMax(e.target.value);
                    // Reset to input if slider and min/max not both set
                    if (numInputType === 'slider' && (!numMin || !e.target.value)) {
                      setNumInputType('input');
                    }
                  }}
                  placeholder={t('settings.promptEditor.createVariable.noLimit')}
                />
              </div>
              <div className="create-variable-modal__number-row">
                <label className="create-variable-modal__number-label">{t('settings.promptEditor.createVariable.step')}</label>
                <input
                  type="number"
                  className="create-variable-modal__number-input"
                  value={numStep}
                  onChange={(e) => setNumStep(e.target.value)}
                  placeholder="1"
                  min="0.001"
                  step="any"
                />
              </div>
              <div className="create-variable-modal__number-row">
                <label className="create-variable-modal__number-label">{t('settings.promptEditor.createVariable.displayAs')}</label>
                <CustomSelect
                  className="create-variable-modal__number-select"
                  value={numInputType}
                  onChange={(value) => setNumInputType(value as 'input' | 'slider')}
                  options={[
                    { value: 'input', label: t('settings.promptEditor.createVariable.inputField') },
                    { value: 'slider', label: t('settings.promptEditor.createVariable.slider'), disabled: !canUseSlider },
                  ]}
                />
              </div>
              {!canUseSlider && (
                <p className="create-variable-modal__hint">
                  {t('settings.promptEditor.createVariable.sliderRequiresMinMax')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Default value */}
        <div className="create-variable-modal__field">
          <label className="create-variable-modal__label">{t('settings.promptEditor.createVariable.defaultValue')}</label>
          {varType === 'boolean' ? (
            <CustomSelect
              className="create-variable-modal__select"
              value={defaultValue}
              onChange={setDefaultValue}
              placeholder={t('settings.promptEditor.createVariable.select')}
              options={[
                { value: 'true', label: 'true' },
                { value: 'false', label: 'false' },
              ]}
            />
          ) : varType === 'select' ? (
            <CustomSelect
              className="create-variable-modal__select"
              value={defaultValue}
              onChange={setDefaultValue}
              placeholder={t('settings.promptEditor.createVariable.select')}
              disabled={selectOptions.length === 0}
              options={selectOptions.map((option) => ({
                value: option,
                label: option,
              }))}
            />
          ) : (
            <input
              type={varType === 'number' ? 'number' : 'text'}
              className="create-variable-modal__input"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder={varType === 'number' ? '0' : t('settings.promptEditor.createVariable.enterDefaultValue')}
            />
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="create-variable-modal__error">{error}</div>
        )}

        {/* Actions */}
        <div className="create-variable-modal__actions">
          <button
            className="create-variable-modal__btn create-variable-modal__btn--secondary"
            onClick={handleClose}
            type="button"
          >
            {t('common.cancel')}
          </button>
          <button
            className="create-variable-modal__btn create-variable-modal__btn--primary"
            onClick={handleCreate}
            disabled={isCreating}
            type="button"
          >
            {isCreating ? t('settings.promptEditor.createVariable.creating') : t('settings.promptEditor.createVariable.createVariable')}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};

export default CreateVariableModal;
