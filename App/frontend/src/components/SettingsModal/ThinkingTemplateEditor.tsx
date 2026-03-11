import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomSelect } from '../ui/CustomSelect';
import { TextButton } from '../TextButton';
import CustomThinkingTemplateManager from './CustomThinkingTemplateManager';
import type { CustomThinkingTemplate } from '../../store/settingsStore';
import { confirm } from '../../store/dialogStore';
import './ThinkingTemplateEditor.css';

interface Props {
  templates: CustomThinkingTemplate[];
  onChange: (templates: CustomThinkingTemplate[]) => void;
}

const ThinkingTemplateEditor: React.FC<Props> = ({
  templates,
  onChange,
}) => {
  const { t } = useTranslation();
  const tp = 'settings.taskConfig.templateManager';
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    const currentStillExists =
      selectedTemplateId && templates.some((tpl) => tpl.id === selectedTemplateId);
    if (!currentStillExists) {
      setSelectedTemplateId(templates[0].id ?? null);
    }
  }, [templates, selectedTemplateId]);

  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId) ?? null;

  const handleCreate = () => {
    const newTemplate: CustomThinkingTemplate = {
      id: crypto.randomUUID(),
      name: 'New Template',
      effort_fields: [],
      response_fields: [],
      history_fields: [],
    };
    onChange([...templates, newTemplate]);
    setSelectedTemplateId(newTemplate.id!);
  };

  const handleDelete = async () => {
    if (!selectedTemplateId) return;
    const confirmed = await confirm({
      title: t(`${tp}.deleteTemplate`),
      message: t(`${tp}.confirmDelete`),
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    const remaining = templates.filter((tpl) => tpl.id !== selectedTemplateId);
    onChange(remaining);
    setSelectedTemplateId(remaining.length > 0 ? (remaining[0].id ?? null) : null);
  };

  const handleUpdateTemplate = (updates: Partial<CustomThinkingTemplate>) => {
    if (!selectedTemplateId) return;
    onChange(
      templates.map((tpl) =>
        tpl.id === selectedTemplateId ? { ...tpl, ...updates } : tpl
      )
    );
  };

  return (
    <div className="template-editor-inline">
      {/* Toolbar: template selector + create */}
      <div className="template-editor-toolbar">
        <CustomSelect
          value={selectedTemplateId || ''}
          onChange={(value) => setSelectedTemplateId(value || null)}
          options={templates
            .filter((tpl) => tpl.id)
            .map((tpl) => ({ value: tpl.id!, label: tpl.name }))}
          placeholder={t(`${tp}.noTemplates`)}
          disabled={templates.length === 0}
        />
        <TextButton size="sm" variant="secondary" onClick={handleCreate}>
          + {t(`${tp}.addTemplate`)}
        </TextButton>
      </div>

      {/* Template editor or empty state */}
      {selectedTemplate ? (
        <CustomThinkingTemplateManager
          template={selectedTemplate}
          onUpdate={handleUpdateTemplate}
        />
      ) : (
        <div className="template-editor-empty">{t(`${tp}.noTemplates`)}</div>
      )}

      <div className="template-editor-footer">
        <TextButton
          size="sm"
          variant="danger"
          onClick={handleDelete}
          disabled={!selectedTemplateId}
        >
          {t(`${tp}.deleteTemplate`)}
        </TextButton>
      </div>
    </div>
  );
};

export default ThinkingTemplateEditor;
