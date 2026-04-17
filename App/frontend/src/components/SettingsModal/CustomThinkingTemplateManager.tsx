import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CustomThinkingTemplate,
  CustomThinkingEffortField,
  CustomThinkingResponseField,
  CustomThinkingHistoryField,
} from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import ToggleSwitch from '../common/ToggleSwitch';
import './CustomThinkingTemplateManager.css';

interface Props {
  template: CustomThinkingTemplate;
  onUpdate: (updates: Partial<CustomThinkingTemplate>) => void;
}

const CustomThinkingTemplateManager: React.FC<Props> = ({ template, onUpdate }) => {
  const { t } = useTranslation();
  const tp = 'settings.taskConfig.templateManager';

  // --- Effort field helpers ---

  const addEffortField = () => {
    onUpdate({
      effort_fields: [
        ...template.effort_fields,
        { path: '', value: '', value_type: 'string' },
      ],
    });
  };

  const updateEffortField = (idx: number, field: Partial<CustomThinkingEffortField>) => {
    onUpdate({
      effort_fields: template.effort_fields.map((f, i) => (i === idx ? { ...f, ...field } : f)),
    });
  };

  const removeEffortField = (idx: number) => {
    onUpdate({ effort_fields: template.effort_fields.filter((_, i) => i !== idx) });
  };

  // --- Response field helpers ---

  const addResponseField = () => {
    onUpdate({
      response_fields: [
        ...template.response_fields,
        { path: '', as_var: '', is_stream_delta: false },
      ],
    });
  };

  const updateResponseField = (idx: number, field: Partial<CustomThinkingResponseField>) => {
    const fields = template.response_fields.map((f, i) => {
      if (i === idx) return { ...f, ...field };
      // Enforce max 1 stream_delta
      if (field.is_stream_delta) return { ...f, is_stream_delta: false };
      return f;
    });
    onUpdate({ response_fields: fields });
  };

  const removeResponseField = (idx: number) => {
    onUpdate({ response_fields: template.response_fields.filter((_, i) => i !== idx) });
  };

  // --- History field helpers ---

  const addHistoryField = () => {
    onUpdate({
      history_fields: [...template.history_fields, { path: '', in_var: '' }],
    });
  };

  const updateHistoryField = (idx: number, field: Partial<CustomThinkingHistoryField>) => {
    onUpdate({
      history_fields: template.history_fields.map((f, i) =>
        i === idx ? { ...f, ...field } : f
      ),
    });
  };

  const removeHistoryField = (idx: number) => {
    onUpdate({ history_fields: template.history_fields.filter((_, i) => i !== idx) });
  };

  return (
    <div className="thinking-template-editor">
      {/* Template Name */}
      <div className="template-name-field">
        <label>{t(`${tp}.templateName`)}</label>
        <input
          type="text"
          value={template.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="template-name-input"
          placeholder={t(`${tp}.templateNamePlaceholder`)}
        />
      </div>

      {/* Effort Fields */}
      <div className="template-field-section">
        <label className="field-section-label">{t(`${tp}.effortFields`)}</label>
        <p className="field-section-hint">{t(`${tp}.effortFieldsHint`)}</p>
        {template.effort_fields.map((field, idx) => (
          <div key={idx} className="template-field-row effort-row">
            <div className="template-field">
              <label>{t(`${tp}.path`)}</label>
              <input
                type="text"
                value={field.path}
                onChange={(e) => updateEffortField(idx, { path: e.target.value })}
                placeholder="e.g. reasoning.effort"
                className="template-field-input mono"
              />
            </div>
            <div className="template-field">
              <label>{t(`${tp}.value`)}</label>
              <input
                type="text"
                value={field.value}
                onChange={(e) => updateEffortField(idx, { value: e.target.value })}
                placeholder="e.g. high"
                className="template-field-input mono"
              />
            </div>
            <div className="template-field value-type-field">
              <label>{t(`${tp}.valueType`)}</label>
              <select
                value={field.value_type}
                onChange={(e) =>
                  updateEffortField(idx, {
                    value_type: e.target.value as CustomThinkingEffortField['value_type'],
                  })
                }
                className="template-field-input mono"
              >
                <option value="string">{t(`${tp}.valueTypeString`)}</option>
                <option value="number">{t(`${tp}.valueTypeNumber`)}</option>
                <option value="boolean">{t(`${tp}.valueTypeBoolean`)}</option>
              </select>
            </div>
            <button className="remove-field-button" onClick={() => removeEffortField(idx)}>
              &times;
            </button>
          </div>
        ))}
        <TextButton size="sm" onClick={addEffortField}>
          + {t(`${tp}.addRow`)}
        </TextButton>
      </div>

      {/* Response Fields */}
      <div className="template-field-section">
        <label className="field-section-label">{t(`${tp}.responseFields`)}</label>
        <p className="field-section-hint">{t(`${tp}.responseFieldsHint`)}</p>
        {template.response_fields.map((field, idx) => (
          <div key={idx} className="template-field-row response-row">
            <div className="template-field">
              <label>{t(`${tp}.path`)}</label>
              <input
                type="text"
                value={field.path}
                onChange={(e) => updateResponseField(idx, { path: e.target.value })}
                placeholder="e.g. reasoning"
                className="template-field-input mono"
              />
            </div>
            <span className="field-arrow">To</span>
            <div className="template-field">
              <label>{t(`${tp}.variableName`)}</label>
              <input
                type="text"
                value={field.as_var}
                onChange={(e) => updateResponseField(idx, { as_var: e.target.value })}
                placeholder="e.g. thinking"
                className="template-field-input mono"
              />
            </div>
            <div className="template-field stream-toggle-field">
              <ToggleSwitch
                checked={field.is_stream_delta ?? false}
                onChange={(checked) => updateResponseField(idx, { is_stream_delta: checked })}
                label={t(`${tp}.streamDisplay`)}
              />
            </div>
            <button className="remove-field-button" onClick={() => removeResponseField(idx)}>
              &times;
            </button>
          </div>
        ))}
        <TextButton size="sm" onClick={addResponseField}>
          + {t(`${tp}.addRow`)}
        </TextButton>
      </div>

      {/* History Fields */}
      <div className="template-field-section">
        <label className="field-section-label">{t(`${tp}.historyFields`)}</label>
        <p className="field-section-hint">{t(`${tp}.historyFieldsHint`)}</p>
        {template.history_fields.map((field, idx) => (
          <div key={idx} className="template-field-row arrow-row">
            <div className="template-field">
              <label>{t(`${tp}.path`)}</label>
              <input
                type="text"
                value={field.path}
                onChange={(e) => updateHistoryField(idx, { path: e.target.value })}
                placeholder="e.g. reasoning_content"
                className="template-field-input mono"
              />
            </div>
            <span className="field-arrow">From</span>
            <div className="template-field">
              <label>{t(`${tp}.variableName`)}</label>
              <input
                type="text"
                value={field.in_var}
                onChange={(e) => updateHistoryField(idx, { in_var: e.target.value })}
                placeholder="e.g. thinking"
                className="template-field-input mono"
              />
            </div>
            <button className="remove-field-button" onClick={() => removeHistoryField(idx)}>
              &times;
            </button>
          </div>
        ))}
        <TextButton size="sm" onClick={addHistoryField}>
          + {t(`${tp}.addRow`)}
        </TextButton>
      </div>
    </div>
  );
};

export default CustomThinkingTemplateManager;
