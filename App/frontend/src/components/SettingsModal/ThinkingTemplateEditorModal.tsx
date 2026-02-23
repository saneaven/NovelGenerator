import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../BaseModal';
import { CustomSelect } from '../ui/CustomSelect';
import { TextButton } from '../TextButton';
import CustomThinkingTemplateManager from './CustomThinkingTemplateManager';
import type { CustomThinkingTemplate } from '../../store/settingsStore';
import './ThinkingTemplateEditorModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  templates: CustomThinkingTemplate[];
  onChange: (templates: CustomThinkingTemplate[]) => void;
}

const ThinkingTemplateEditorModal: React.FC<Props> = ({
  isOpen,
  onClose,
  templates,
  onChange,
}) => {
  const { t } = useTranslation();
  const tp = 'settings.taskConfig.templateManager';
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Auto-select first template when modal opens, or keep selection if still valid
  useEffect(() => {
    if (!isOpen) return;
    if (templates.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    const currentStillExists =
      selectedTemplateId && templates.some((tpl) => tpl.id === selectedTemplateId);
    if (!currentStillExists) {
      setSelectedTemplateId(templates[0].id ?? null);
    }
  }, [isOpen, templates, selectedTemplateId]);

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

  const handleDelete = () => {
    if (!selectedTemplateId) return;
    if (!window.confirm(t(`${tp}.confirmDelete`))) return;
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
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t(`${tp}.title`)}
      size="large"
      zIndexLayer={1}
      footer={
        <TextButton variant="secondary" onClick={onClose}>
          {t('common.close')}
        </TextButton>
      }
    >
      {/* Toolbar: template selector + create/delete */}
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
        <TextButton
          size="sm"
          variant="danger"
          onClick={handleDelete}
          disabled={!selectedTemplateId}
        >
          {t(`${tp}.deleteTemplate`)}
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
    </BaseModal>
  );
};

export default ThinkingTemplateEditorModal;
