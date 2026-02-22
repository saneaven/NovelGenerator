import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CustomThinkingTemplate,
  CustomThinkingEffortField,
  CustomThinkingResponseField,
  CustomThinkingHistoryField,
} from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import { Trash } from '../icons';
import './CustomThinkingTemplateManager.css';

interface Props {
  templates: CustomThinkingTemplate[];
  onChange: (templates: CustomThinkingTemplate[]) => void;
}

const CustomThinkingTemplateManager: React.FC<Props> = ({ templates, onChange }) => {
  const { t } = useTranslation();
  // editingId: the backend-assigned id of the template being edited (null when adding new)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomThinkingTemplate | null>(null);

  const handleAdd = () => {
    setDraft({ name: '', effort_fields: [], response_fields: [], history_fields: [] });
    setEditingId(null);
  };

  const handleEdit = (tpl: CustomThinkingTemplate) => {
    setDraft({ ...tpl, effort_fields: [...tpl.effort_fields], response_fields: [...tpl.response_fields], history_fields: [...tpl.history_fields] });
    setEditingId(tpl.id ?? null);
  };

  const handleSave = () => {
    if (!draft || !draft.name.trim()) return;
    if (editingId) {
      // Editing existing template
      onChange(templates.map((t) => (t.id === editingId ? { ...draft, id: editingId } : t)));
    } else {
      // Adding new template (backend assigns id)
      onChange([...templates, draft]);
    }
    setEditingId(null);
    setDraft(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setDraft(null);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t('settings.taskConfig.templateManager.confirmDelete'))) return;
    onChange(templates.filter((t) => t.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setDraft(null);
    }
  };

  // Effort field helpers
  const addEffortField = () => {
    if (!draft) return;
    setDraft({ ...draft, effort_fields: [...draft.effort_fields, { path: '', value: '' }] });
  };
  const updateEffortField = (idx: number, field: Partial<CustomThinkingEffortField>) => {
    if (!draft) return;
    const fields = [...draft.effort_fields];
    fields[idx] = { ...fields[idx], ...field };
    setDraft({ ...draft, effort_fields: fields });
  };
  const removeEffortField = (idx: number) => {
    if (!draft) return;
    setDraft({ ...draft, effort_fields: draft.effort_fields.filter((_, i) => i !== idx) });
  };

  // Response field helpers
  const addResponseField = () => {
    if (!draft) return;
    setDraft({ ...draft, response_fields: [...draft.response_fields, { path: '', as_var: '', is_stream_delta: false }] });
  };
  const updateResponseField = (idx: number, field: Partial<CustomThinkingResponseField>) => {
    if (!draft) return;
    const fields = [...draft.response_fields];
    fields[idx] = { ...fields[idx], ...field };
    // Enforce max 1 stream_delta
    if (field.is_stream_delta) {
      fields.forEach((f, i) => { if (i !== idx) f.is_stream_delta = false; });
    }
    setDraft({ ...draft, response_fields: fields });
  };
  const removeResponseField = (idx: number) => {
    if (!draft) return;
    setDraft({ ...draft, response_fields: draft.response_fields.filter((_, i) => i !== idx) });
  };

  // History field helpers
  const addHistoryField = () => {
    if (!draft) return;
    setDraft({ ...draft, history_fields: [...draft.history_fields, { path: '', in_var: '' }] });
  };
  const updateHistoryField = (idx: number, field: Partial<CustomThinkingHistoryField>) => {
    if (!draft) return;
    const fields = [...draft.history_fields];
    fields[idx] = { ...fields[idx], ...field };
    setDraft({ ...draft, history_fields: fields });
  };
  const removeHistoryField = (idx: number) => {
    if (!draft) return;
    setDraft({ ...draft, history_fields: draft.history_fields.filter((_, i) => i !== idx) });
  };

  const tp = 'settings.taskConfig.templateManager';

  return (
    <div className="thinking-template-manager">
      <h4>{t(`${tp}.title`)}</h4>

      {templates.length === 0 && !draft && (
        <p className="no-templates">{t(`${tp}.noTemplates`)}</p>
      )}

      {/* Template list */}
      {templates.map((tpl) =>
        editingId && editingId === tpl.id ? null : (
          <div key={tpl.id ?? tpl.name} className="template-row">
            <span className="template-name">{tpl.name}</span>
            <div className="template-actions">
              <TextButton size="small" onClick={() => handleEdit(tpl)}>
                {t(`${tp}.editTemplate`)}
              </TextButton>
              <TextButton size="small" variant="danger" onClick={() => handleDelete(tpl.id!)} disabled={!tpl.id}>
                <Trash size="sm" />
              </TextButton>
            </div>
          </div>
        )
      )}

      {/* Editor */}
      {draft && (
        <div className="template-editor">
          <div className="editor-field">
            <label>{t(`${tp}.templateName`)}</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t(`${tp}.templateNamePlaceholder`)}
            />
          </div>

          {/* Effort fields */}
          <div className="editor-section">
            <label>{t(`${tp}.effortFields`)}</label>
            <p className="section-hint">{t(`${tp}.effortFieldsHint`)}</p>
            {draft.effort_fields.map((field, idx) => (
              <div key={idx} className="field-row">
                <input
                  type="text"
                  placeholder={t(`${tp}.path`)}
                  value={field.path}
                  onChange={(e) => updateEffortField(idx, { path: e.target.value })}
                />
                <input
                  type="text"
                  placeholder={t(`${tp}.value`)}
                  value={field.value}
                  onChange={(e) => updateEffortField(idx, { value: e.target.value })}
                />
                <button className="remove-btn" onClick={() => removeEffortField(idx)}>
                  <Trash size="sm" />
                </button>
              </div>
            ))}
            <TextButton size="small" onClick={addEffortField}>+ {t(`${tp}.addRow`)}</TextButton>
          </div>

          {/* Response fields */}
          <div className="editor-section">
            <label>{t(`${tp}.responseFields`)}</label>
            <p className="section-hint">{t(`${tp}.responseFieldsHint`)}</p>
            {draft.response_fields.map((field, idx) => (
              <div key={idx} className="field-row">
                <input
                  type="text"
                  placeholder={t(`${tp}.path`)}
                  value={field.path}
                  onChange={(e) => updateResponseField(idx, { path: e.target.value })}
                />
                <input
                  type="text"
                  placeholder={t(`${tp}.variableName`)}
                  value={field.as_var}
                  onChange={(e) => updateResponseField(idx, { as_var: e.target.value })}
                />
                <label className="stream-toggle" title={t(`${tp}.streamDisplay`)}>
                  <input
                    type="checkbox"
                    checked={field.is_stream_delta ?? false}
                    onChange={(e) => updateResponseField(idx, { is_stream_delta: e.target.checked })}
                  />
                  <span className="stream-label">{t(`${tp}.streamDisplay`)}</span>
                </label>
                <button className="remove-btn" onClick={() => removeResponseField(idx)}>
                  <Trash size="sm" />
                </button>
              </div>
            ))}
            <TextButton size="small" onClick={addResponseField}>+ {t(`${tp}.addRow`)}</TextButton>
          </div>

          {/* History fields */}
          <div className="editor-section">
            <label>{t(`${tp}.historyFields`)}</label>
            <p className="section-hint">{t(`${tp}.historyFieldsHint`)}</p>
            {draft.history_fields.map((field, idx) => (
              <div key={idx} className="field-row">
                <input
                  type="text"
                  placeholder={t(`${tp}.path`)}
                  value={field.path}
                  onChange={(e) => updateHistoryField(idx, { path: e.target.value })}
                />
                <input
                  type="text"
                  placeholder={t(`${tp}.variableName`)}
                  value={field.in_var}
                  onChange={(e) => updateHistoryField(idx, { in_var: e.target.value })}
                />
                <button className="remove-btn" onClick={() => removeHistoryField(idx)}>
                  <Trash size="sm" />
                </button>
              </div>
            ))}
            <TextButton size="small" onClick={addHistoryField}>+ {t(`${tp}.addRow`)}</TextButton>
          </div>

          {/* Actions */}
          <div className="editor-actions">
            <TextButton size="small" onClick={handleCancel}>{t(`${tp}.cancel`)}</TextButton>
            <TextButton size="small" variant="primary" onClick={handleSave} disabled={!draft.name.trim()}>
              {t(`${tp}.saveTemplate`)}
            </TextButton>
          </div>
        </div>
      )}

      {!draft && (
        <TextButton size="small" onClick={handleAdd}>+ {t(`${tp}.addTemplate`)}</TextButton>
      )}
    </div>
  );
};

export default CustomThinkingTemplateManager;
